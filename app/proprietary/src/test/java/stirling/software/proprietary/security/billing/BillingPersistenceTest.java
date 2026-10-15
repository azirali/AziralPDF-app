package stirling.software.proprietary.security.billing;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.*;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.SharedEntityManagerCreator;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import jakarta.persistence.EntityManagerFactory;

import stirling.software.proprietary.security.database.repository.BillingPaymentRepository;
import stirling.software.proprietary.security.database.repository.UserRepository;
import stirling.software.proprietary.security.filter.FreeTierLimitInterceptor;
import stirling.software.proprietary.security.model.BillingPayment.Status;
import stirling.software.proprietary.security.model.LicenseTier;
import stirling.software.proprietary.security.model.User;

class BillingPersistenceTest {
    static EntityManagerFactory emf;
    static JpaTransactionManager manager;
    static UserRepository users;
    static BillingPaymentRepository payments;
    BillingProperties properties;
    FreedomPayClient gateway;
    BillingService service;
    Clock clock = Clock.fixed(Instant.parse("2030-01-31T12:00:00Z"), ZoneOffset.UTC);

    @BeforeAll
    static void database() {
        var source =
                new DriverManagerDataSource(
                        "jdbc:h2:mem:aziral-billing;DB_CLOSE_DELAY=-1", "sa", "");
        var factory = new LocalContainerEntityManagerFactoryBean();
        factory.setDataSource(source);
        factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
        factory.setPackagesToScan(
                "stirling.software.proprietary.security.model",
                "stirling.software.proprietary.model",
                "stirling.software.proprietary.storage.model",
                "stirling.software.proprietary.workflow.model");
        factory.setJpaPropertyMap(
                Map.of("hibernate.hbm2ddl.auto", "create-drop", "hibernate.show_sql", "false"));
        factory.afterPropertiesSet();
        emf = factory.getObject();
        manager = new JpaTransactionManager(emf);
        var repositories =
                new JpaRepositoryFactory(SharedEntityManagerCreator.createSharedEntityManager(emf));
        users = repositories.getRepository(UserRepository.class);
        payments = repositories.getRepository(BillingPaymentRepository.class);
    }

    @AfterAll
    static void close() {
        if (emf != null) emf.close();
    }

    @AfterEach
    void clearSecurity() {
        SecurityContextHolder.clearContext();
    }

    @BeforeEach
    void setup() {
        properties = new BillingProperties();
        properties.setEnabled(true);
        properties.setMerchantId("12345");
        properties.setSecretKey("test-key");
        properties.setTestMode(false);
        gateway = mock(FreedomPayClient.class);
        AtomicLong next = new AtomicLong(System.nanoTime());
        when(gateway.create(any(), anyString()))
                .thenAnswer(
                        inv ->
                                new FreedomPayClient.Checkout(
                                        Long.toString(next.incrementAndGet()),
                                        "https://customer.freedompay.kz/pay?id="
                                                + UUID.randomUUID()));
        service =
                new BillingService(
                        users,
                        payments,
                        properties,
                        gateway,
                        mock(HalykEpayClient.class),
                        repositoriesForInvoices(),
                        manager,
                        Optional.empty(),
                        clock);
    }

    static stirling.software.proprietary.security.database.repository.HalykInvoiceNumberRepository
            repositoriesForInvoices() {
        return new JpaRepositoryFactory(SharedEntityManagerCreator.createSharedEntityManager(emf))
                .getRepository(
                        stirling.software.proprietary.security.database.repository
                                .HalykInvoiceNumberRepository.class);
    }

    User account() {
        return new TransactionTemplate(manager)
                .execute(
                        tx -> {
                            User u = new User();
                            u.setUsername(UUID.randomUUID().toString());
                            u.setEmail(u.getUsername() + "@example.com");
                            u.setEnabled(true);
                            return users.saveAndFlush(u);
                        });
    }

    BillingService.PaymentView checkout(User user) {
        return service.checkout(
                user.getUsername(),
                BillingPlan.PRO_MONTHLY,
                UUID.randomUUID(),
                true,
                BillingService.TERMS_VERSION);
    }

    Map<String, String> callback(BillingService.PaymentView view) {
        var entity = payments.findById(view.id()).orElseThrow();
        return signed(
                new LinkedHashMap<>(
                        Map.of(
                                "pg_order_id",
                                view.id(),
                                "pg_payment_id",
                                entity.getProviderPaymentId(),
                                "pg_amount",
                                entity.getAmount().toPlainString(),
                                "pg_currency",
                                "KZT",
                                "pg_testing_mode",
                                entity.isTesting() ? "1" : "0",
                                "pg_result",
                                "1",
                                "pg_captured",
                                "1",
                                "pg_salt",
                                "random")));
    }

    Map<String, String> signed(Map<String, String> fields) {
        fields.put("pg_sig", FreedomPayProtocol.sign("result", fields, properties.getSecretKey()));
        return fields;
    }

    @Test
    void paidCallbackGrantsOnceAndExtendsExistingPeriod() {
        User u = account();
        var order = checkout(u);
        var fields = callback(order);
        service.callback("result", fields);
        service.callback("result", fields);
        User paid = users.findById(u.getId()).orElseThrow();
        assertEquals(LicenseTier.PRO, paid.getEffectiveLicenseTier());
        assertEquals(LocalDateTime.of(2030, 2, 28, 12, 0), paid.getLicenseExpiresAt());
        var second = checkout(u);
        service.callback("result", callback(second));
        assertEquals(
                LocalDateTime.of(2030, 3, 28, 12, 0),
                users.findById(u.getId()).orElseThrow().getLicenseExpiresAt());
        assertEquals(Status.PAID, payments.findById(order.id()).orElseThrow().getStatus());
    }

    @Test
    void duplicateAndConcurrentCallbacksDoNotDoubleCredit() throws Exception {
        User u = account();
        var order = checkout(u);
        var fields = callback(order);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var results =
                    executor.invokeAll(
                            List.<Callable<Void>>of(
                                    () -> {
                                        service.callback("result", fields);
                                        return null;
                                    },
                                    () -> {
                                        service.callback("result", fields);
                                        return null;
                                    }));
            for (var result : results) result.get();
        }
        assertEquals(
                LocalDateTime.of(2030, 2, 28, 12, 0),
                users.findById(u.getId()).orElseThrow().getLicenseExpiresAt());
    }

    @Test
    void concurrentCheckoutAndRequestReplayCreateOnlyOneProviderPayment() throws Exception {
        User u = account();
        UUID request = UUID.randomUUID();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var tasks =
                    List.<Callable<BillingService.PaymentView>>of(
                            () ->
                                    service.checkout(
                                            u.getUsername(),
                                            BillingPlan.PRO_MONTHLY,
                                            request,
                                            true,
                                            BillingService.TERMS_VERSION),
                            () ->
                                    service.checkout(
                                            u.getUsername(),
                                            BillingPlan.PRO_MONTHLY,
                                            UUID.randomUUID(),
                                            true,
                                            BillingService.TERMS_VERSION));
            var results = executor.invokeAll(tasks);
            assertEquals(results.get(0).get().id(), results.get(1).get().id());
        }
        service.checkout(
                u.getUsername(),
                BillingPlan.PRO_MONTHLY,
                request,
                true,
                BillingService.TERMS_VERSION);
        verify(gateway, times(1)).create(any(), anyString());
    }

    @Test
    void tamperingWrongAmountCurrencyMerchantModeOrProviderIdNeverGrantsAccess() {
        User u = account();
        var order = checkout(u);
        for (var mismatch :
                Map.of(
                                "pg_amount",
                                "0.01",
                                "pg_currency",
                                "USD",
                                "pg_testing_mode",
                                "1",
                                "pg_merchant_id",
                                "999",
                                "pg_payment_id",
                                "1")
                        .entrySet()) {
            var fields = callback(order);
            fields.put(mismatch.getKey(), mismatch.getValue());
            signed(fields);
            assertThrows(ResponseStatusException.class, () -> service.callback("result", fields));
        }
        var unsigned = callback(order);
        unsigned.put("pg_amount", "1");
        assertThrows(ResponseStatusException.class, () -> service.callback("result", unsigned));
        assertEquals(
                LicenseTier.FREE,
                users.findById(u.getId()).orElseThrow().getEffectiveLicenseTier());
    }

    @Test
    void holdsPendingFailedAndTestPaymentsDoNotGrantPro() {
        User u = account();
        var order = checkout(u);
        var hold = callback(order);
        hold.put("pg_captured", "0");
        signed(hold);
        service.callback("result", hold);
        assertEquals(Status.AUTHORIZED, payments.findById(order.id()).orElseThrow().getStatus());
        var failed = callback(order);
        failed.put("pg_result", "0");
        signed(failed);
        service.callback("result", failed);
        assertEquals(
                LicenseTier.FREE,
                users.findById(u.getId()).orElseThrow().getEffectiveLicenseTier());
        properties.setTestMode(true);
        var test = checkout(u);
        service.callback("result", callback(test));
        assertEquals(Status.TEST_PAID, payments.findById(test.id()).orElseThrow().getStatus());
        assertEquals(
                LicenseTier.FREE,
                users.findById(u.getId()).orElseThrow().getEffectiveLicenseTier());
    }

    @Test
    void anotherAccountCannotReadPaymentAndDisabledGatewayCannotCreateIt() {
        User first = account(), second = account();
        var order = checkout(first);
        assertEquals(
                404,
                assertThrows(
                                ResponseStatusException.class,
                                () -> service.get(second.getUsername(), order.id()))
                        .getStatusCode()
                        .value());
        properties.setEnabled(false);
        assertEquals(
                503,
                assertThrows(ResponseStatusException.class, () -> checkout(second))
                        .getStatusCode()
                        .value());
    }

    @Test
    void callbackIsRequiredAndFreeLimitDisappearsOnlyAfterRealPayment() throws Exception {
        User u = account();
        var order = checkout(u);
        FreeTierLimitInterceptor limit = new FreeTierLimitInterceptor(users);
        ReflectionTestUtils.setField(limit, "freeDailyLimit", 1);
        SecurityContextHolder.getContext()
                .setAuthentication(
                        new UsernamePasswordAuthenticationToken(u.getUsername(), "", List.of()));
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/v1/convert/pdf/cbr");
        assertTrue(limit.preHandle(req, new MockHttpServletResponse(), new Object()));
        assertFalse(limit.preHandle(req, new MockHttpServletResponse(), new Object()));
        assertEquals(
                LicenseTier.FREE,
                users.findById(u.getId()).orElseThrow().getEffectiveLicenseTier());
        service.callback("result", callback(order));
        assertTrue(limit.preHandle(req, new MockHttpServletResponse(), new Object()));
    }

    @Test
    void annualPricingAndConsentAreServerControlled() {
        User u = account();
        assertThrows(
                ResponseStatusException.class,
                () ->
                        service.checkout(
                                u.getUsername(),
                                BillingPlan.PRO_YEARLY,
                                UUID.randomUUID(),
                                false,
                                BillingService.TERMS_VERSION));
        var annual =
                service.checkout(
                        u.getUsername(),
                        BillingPlan.PRO_YEARLY,
                        UUID.randomUUID(),
                        true,
                        BillingService.TERMS_VERSION);
        assertEquals(new java.math.BigDecimal("19900.00"), annual.amount());
        service.callback("result", callback(annual));
        assertEquals(
                LocalDateTime.of(2031, 1, 31, 12, 0),
                users.findById(u.getId()).orElseThrow().getLicenseExpiresAt());
    }

    HalykEpayClient useHalyk() {
        properties.setProvider(BillingProvider.HALYK_EPAY);
        properties.setHalykClientId("merchant");
        properties.setHalykClientSecret("private-client-secret");
        properties.setHalykTerminalId("67e34d63-102f-4bd1-898e-370781d0074d");
        HalykEpayClient bank = mock(HalykEpayClient.class);
        service =
                new BillingService(
                        users,
                        payments,
                        properties,
                        gateway,
                        bank,
                        repositoriesForInvoices(),
                        manager,
                        Optional.empty(),
                        clock);
        return bank;
    }

    HalykEpayClient.BankStatus bankStatus(BillingService.PaymentView view, String status) {
        var p = payments.findById(view.id()).orElseThrow();
        return new HalykEpayClient.BankStatus(
                UUID.randomUUID().toString(),
                p.getHalykInvoice(),
                p.getAmount(),
                "KZT",
                p.getTerminalId(),
                status);
    }

    void advanceBankCheck(String id) {
        new TransactionTemplate(manager)
                .executeWithoutResult(
                        tx -> {
                            var p = payments.findForUpdate(id).orElseThrow();
                            p.setLastCheckedAt(null);
                            payments.saveAndFlush(p);
                        });
    }

    @Test
    void halykAuthenticatedChargeGrantsOnceAndWrongCallbackSecretCannotQueryBank() {
        HalykEpayClient bank = useHalyk();
        User u = account();
        var order = checkout(u);
        var p = payments.findById(order.id()).orElseThrow();
        assertTrue(p.getHalykInvoice().matches("[0-9]{6}"));
        assertEquals(BillingProvider.HALYK_EPAY, order.provider());
        assertEquals("https://pdf.aziral.com/billing/halyk/" + order.id(), order.checkoutUrl());
        when(bank.status(any())).thenReturn(bankStatus(order, "CHARGE"));
        assertThrows(
                ResponseStatusException.class,
                () -> service.halykCallback(p.getHalykInvoice(), "forged"));
        verifyNoInteractions(bank);
        try (var pool = Executors.newFixedThreadPool(4)) {
            var jobs =
                    java.util.stream.IntStream.range(0, 4)
                            .<Callable<Void>>mapToObj(
                                    n ->
                                            () -> {
                                                service.halykCallback(
                                                        p.getHalykInvoice(),
                                                        p.getVerificationSecret());
                                                return null;
                                            })
                            .toList();
            for (var result : pool.invokeAll(jobs)) result.get();
        } catch (Exception e) {
            throw new AssertionError(e);
        }
        service.halykCallback(
                p.getHalykInvoice(),
                java.util.Base64.getEncoder()
                        .encodeToString(
                                p.getVerificationSecret()
                                        .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        verify(bank, times(1)).status(any());
        assertEquals(Status.PAID, payments.findById(order.id()).orElseThrow().getStatus());
        var owner = users.findById(u.getId()).orElseThrow();
        assertEquals(LicenseTier.PRO, owner.getLicenseTier());
        assertEquals(LocalDateTime.of(2030, 2, 28, 12, 0), owner.getLicenseExpiresAt());
    }

    @Test
    void halykHoldDoesNotGrantAndReconciliationRecoversMissingWebhook() {
        HalykEpayClient bank = useHalyk();
        User u = account();
        var order = checkout(u);
        var held = bankStatus(order, "AUTH");
        when(bank.status(any())).thenReturn(held);
        assertEquals(Status.AUTHORIZED, service.get(u.getUsername(), order.id()).status());
        assertEquals(
                LicenseTier.FREE,
                users.findById(u.getId()).orElseThrow().getEffectiveLicenseTier());
        advanceBankCheck(order.id());
        when(bank.status(any()))
                .thenReturn(
                        new HalykEpayClient.BankStatus(
                                held.transactionId(),
                                held.invoice(),
                                held.amount(),
                                held.currency(),
                                held.terminalId(),
                                "CHARGE"));
        service.reconcileHalyk();
        assertEquals(Status.PAID, payments.findById(order.id()).orElseThrow().getStatus());
    }

    @Test
    void halykTestChargeNeverActivatesProAndInvoiceNumbersAreUnique() {
        HalykEpayClient bank = useHalyk();
        properties.setTestMode(true);
        User u = account();
        var order = checkout(u);
        var other = checkout(account());
        assertNotEquals(
                payments.findById(order.id()).orElseThrow().getHalykInvoice(),
                payments.findById(other.id()).orElseThrow().getHalykInvoice());
        when(bank.status(any())).thenReturn(bankStatus(order, "CHARGE"));
        assertEquals(Status.TEST_PAID, service.get(u.getUsername(), order.id()).status());
        assertEquals(
                LicenseTier.FREE,
                users.findById(u.getId()).orElseThrow().getEffectiveLicenseTier());
    }

    @Test
    void halykRejectsMismatchedBankDetailsAndForeignSession() {
        HalykEpayClient bank = useHalyk();
        User u = account();
        var order = checkout(u);
        var valid = bankStatus(order, "CHARGE");
        for (var status :
                List.of(
                        new HalykEpayClient.BankStatus(
                                valid.transactionId(),
                                "999999",
                                valid.amount(),
                                "KZT",
                                valid.terminalId(),
                                "CHARGE"),
                        new HalykEpayClient.BankStatus(
                                valid.transactionId(),
                                valid.invoice(),
                                java.math.BigDecimal.ONE,
                                "KZT",
                                valid.terminalId(),
                                "CHARGE"),
                        new HalykEpayClient.BankStatus(
                                valid.transactionId(),
                                valid.invoice(),
                                valid.amount(),
                                "USD",
                                valid.terminalId(),
                                "CHARGE"),
                        new HalykEpayClient.BankStatus(
                                valid.transactionId(),
                                valid.invoice(),
                                valid.amount(),
                                "KZT",
                                UUID.randomUUID().toString(),
                                "CHARGE"))) {
            when(bank.status(any())).thenReturn(status);
            advanceBankCheck(order.id());
            assertThrows(
                    ResponseStatusException.class, () -> service.get(u.getUsername(), order.id()));
            assertEquals(Status.PENDING, payments.findById(order.id()).orElseThrow().getStatus());
        }
        assertThrows(
                ResponseStatusException.class,
                () -> service.halykSession(account().getUsername(), order.id()));
        verify(bank, never()).session(any(), any());
        assertEquals(
                LicenseTier.FREE,
                users.findById(u.getId()).orElseThrow().getEffectiveLicenseTier());
    }
}
