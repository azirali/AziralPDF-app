package stirling.software.proprietary.security.database.repository;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

import stirling.software.proprietary.security.model.BillingPayment;
import stirling.software.proprietary.security.model.BillingPayment.Status;

public interface BillingPaymentRepository extends JpaRepository<BillingPayment, String> {
    Optional<BillingPayment> findByUserIdAndRequestKey(Long userId, String requestKey);

    List<BillingPayment> findTop20ByUserIdOrderByCreatedAtDesc(Long userId);

    Optional<BillingPayment> findFirstByUserIdAndStatusInAndExpiresAtAfterOrderByCreatedAtDesc(
            Long userId, Collection<Status> statuses, LocalDateTime now);

    Optional<BillingPayment> findByHalykInvoice(String invoice);

    List<BillingPayment>
            findTop20ByHalykInvoiceNotNullAndStatusInAndCreatedAtAfterOrderByLastCheckedAtAsc(
                    Collection<Status> statuses, LocalDateTime after);

    long countByUserIdAndCreatedAtAfter(Long userId, LocalDateTime start);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from BillingPayment p where p.id = :id")
    Optional<BillingPayment> findForUpdate(@Param("id") String id);
}
