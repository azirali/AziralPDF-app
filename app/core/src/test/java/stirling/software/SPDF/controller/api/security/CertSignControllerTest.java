package stirling.software.SPDF.controller.api.security;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.StringWriter;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.cert.CertificateExpiredException;
import java.security.cert.X509Certificate;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder;
import org.bouncycastle.openssl.jcajce.JcaPEMWriter;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import stirling.software.SPDF.model.api.security.SignPDFWithCertRequest;
import stirling.software.common.service.CustomPDFDocumentFactory;
import stirling.software.common.util.TempFile;
import stirling.software.common.util.TempFileManager;

@ExtendWith(MockitoExtension.class)
class CertSignControllerTest {
    private static ResponseEntity<Resource> streamingOk(byte[] bytes) {
        return ResponseEntity.ok(new ByteArrayResource(bytes));
    }

    private static byte[] drainBody(ResponseEntity<Resource> response) throws java.io.IOException {
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        try (java.io.InputStream __in = response.getBody().getInputStream()) {
            __in.transferTo(baos);
        }
        return baos.toByteArray();
    }

    @Mock private CustomPDFDocumentFactory pdfDocumentFactory;
    @Mock private TempFileManager tempFileManager;

    @InjectMocks private CertSignController certSignController;

    private byte[] pdfBytes;
    private static byte[] pfxBytes;
    private static byte[] p12Bytes;
    private static byte[] jksBytes;
    private static byte[] pemKeyBytes;
    private static byte[] pemCertBytes;
    private static byte[] keyBytes;
    private static byte[] crtCertBytes;
    private static byte[] cerCertBytes;
    private static byte[] derCertBytes;

    private static KeyPair signingKeyPair;

    @BeforeAll
    static void createSigningFixtures() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        signingKeyPair = generator.generateKeyPair();
        Instant now = Instant.now();
        X509Certificate certificate =
                createCertificate(now.minus(1, ChronoUnit.DAYS), now.plus(365, ChronoUnit.DAYS));
        p12Bytes = createKeyStore("PKCS12", certificate);
        pfxBytes = p12Bytes;
        jksBytes = createKeyStore("JKS", certificate);
        pemKeyBytes = encodePem(signingKeyPair.getPrivate());
        keyBytes = pemKeyBytes;
        pemCertBytes = encodePem(certificate);
        crtCertBytes = pemCertBytes;
        cerCertBytes = certificate.getEncoded();
        derCertBytes = certificate.getEncoded();
    }

    private static X509Certificate createCertificate(Instant before, Instant after)
            throws Exception {
        X500Name subject = new X500Name("CN=AziralPDF Signing Test");
        var builder =
                new JcaX509v3CertificateBuilder(
                        subject,
                        BigInteger.ONE,
                        Date.from(before),
                        Date.from(after),
                        subject,
                        signingKeyPair.getPublic());
        var signer =
                new JcaContentSignerBuilder("SHA256withRSA").build(signingKeyPair.getPrivate());
        return new JcaX509CertificateConverter().getCertificate(builder.build(signer));
    }

    private static byte[] createKeyStore(String type, X509Certificate certificate)
            throws Exception {
        KeyStore store = KeyStore.getInstance(type);
        store.load(null, null);
        store.setKeyEntry(
                "test",
                signingKeyPair.getPrivate(),
                "password".toCharArray(),
                new java.security.cert.Certificate[] {certificate});
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        store.store(output, "password".toCharArray());
        return output.toByteArray();
    }

    private static byte[] encodePem(Object value) throws Exception {
        StringWriter output = new StringWriter();
        try (JcaPEMWriter writer = new JcaPEMWriter(output)) {
            writer.writeObject(value);
        }
        return output.toString().getBytes(StandardCharsets.US_ASCII);
    }

    @BeforeEach
    void setUp() throws Exception {
        lenient()
                .when(tempFileManager.createManagedTempFile(anyString()))
                .thenAnswer(
                        inv -> {
                            File f =
                                    Files.createTempFile("test", inv.<String>getArgument(0))
                                            .toFile();
                            TempFile tf = mock(TempFile.class);
                            lenient().when(tf.getFile()).thenReturn(f);
                            lenient().when(tf.getPath()).thenReturn(f.toPath());
                            return tf;
                        });
        try (PDDocument doc = new PDDocument()) {
            doc.addPage(new PDPage());
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            doc.save(baos);
            pdfBytes = baos.toByteArray();
        }
        lenient()
                .when(pdfDocumentFactory.load(any(MultipartFile.class)))
                .thenAnswer(
                        invocation -> {
                            MultipartFile file = invocation.getArgument(0);
                            return Loader.loadPDF(file.getBytes());
                        });
    }

    @Test
    void testExpiredCertificateIsRejected() throws Exception {
        Instant now = Instant.now();
        byte[] expiredStore =
                createKeyStore(
                        "PKCS12",
                        createCertificate(
                                now.minus(2, ChronoUnit.DAYS), now.minus(1, ChronoUnit.DAYS)));
        SignPDFWithCertRequest request = new SignPDFWithCertRequest();
        request.setFileInput(
                new MockMultipartFile("fileInput", "test.pdf", "application/pdf", pdfBytes));
        request.setP12File(
                new MockMultipartFile(
                        "p12File", "expired.p12", "application/x-pkcs12", expiredStore));
        request.setCertType("PKCS12");
        request.setPassword("password");
        request.setShowSignature(false);
        assertThrows(
                CertificateExpiredException.class,
                () -> certSignController.signPDFWithCert(request));
    }

    @Test
    void testSignPdfWithPfx() throws Exception {
        MockMultipartFile pdfFile =
                new MockMultipartFile(
                        "fileInput", "test.pdf", MediaType.APPLICATION_PDF_VALUE, pdfBytes);
        MockMultipartFile pfxFile =
                new MockMultipartFile("p12File", "test-cert.pfx", "application/x-pkcs12", pfxBytes);

        SignPDFWithCertRequest request = new SignPDFWithCertRequest();
        request.setFileInput(pdfFile);
        request.setCertType("PFX");
        request.setP12File(pfxFile);
        request.setPassword("password");
        request.setShowSignature(false);
        request.setReason("test");
        request.setLocation("test");
        request.setName("tester");
        request.setPageNumber(1);
        request.setShowLogo(false);

        ResponseEntity<Resource> response = certSignController.signPDFWithCert(request);

        assertNotNull(response.getBody());
        assertTrue(drainBody(response).length > 0);
    }

    @Test
    void testSignPdfWithPkcs12() throws Exception {
        MockMultipartFile pdfFile =
                new MockMultipartFile(
                        "fileInput", "test.pdf", MediaType.APPLICATION_PDF_VALUE, pdfBytes);
        MockMultipartFile p12File =
                new MockMultipartFile("p12File", "test-cert.p12", "application/x-pkcs12", p12Bytes);

        SignPDFWithCertRequest request = new SignPDFWithCertRequest();
        request.setFileInput(pdfFile);
        request.setCertType("PKCS12");
        request.setP12File(p12File);
        request.setPassword("password");
        request.setShowSignature(false);
        request.setReason("test");
        request.setLocation("test");
        request.setName("tester");
        request.setPageNumber(1);
        request.setShowLogo(false);

        ResponseEntity<Resource> response = certSignController.signPDFWithCert(request);

        assertNotNull(response.getBody());
        assertTrue(drainBody(response).length > 0);
    }

    @Test
    void testSignPdfWithMissingPkcs12FileThrowsError() {
        MockMultipartFile pdfFile =
                new MockMultipartFile(
                        "fileInput", "test.pdf", MediaType.APPLICATION_PDF_VALUE, pdfBytes);

        SignPDFWithCertRequest request = new SignPDFWithCertRequest();
        request.setFileInput(pdfFile);
        request.setCertType("PFX");
        request.setPassword("password");
        request.setShowSignature(false);
        request.setReason("test");
        request.setLocation("test");
        request.setName("tester");
        request.setPageNumber(1);
        request.setShowLogo(false);

        IllegalArgumentException exception =
                assertThrows(
                        IllegalArgumentException.class,
                        () -> certSignController.signPDFWithCert(request));

        assertTrue(exception.getMessage().contains("PKCS12 keystore"));
    }

    @Test
    void testSignPdfWithJks() throws Exception {
        MockMultipartFile pdfFile =
                new MockMultipartFile(
                        "fileInput", "test.pdf", MediaType.APPLICATION_PDF_VALUE, pdfBytes);
        MockMultipartFile jksFile =
                new MockMultipartFile(
                        "jksFile", "test-cert.jks", "application/octet-stream", jksBytes);

        SignPDFWithCertRequest request = new SignPDFWithCertRequest();
        request.setFileInput(pdfFile);
        request.setCertType("JKS");
        request.setJksFile(jksFile);
        request.setPassword("password");
        request.setShowSignature(false);
        request.setReason("test");
        request.setLocation("test");
        request.setName("tester");
        request.setPageNumber(1);
        request.setShowLogo(false);

        ResponseEntity<Resource> response = certSignController.signPDFWithCert(request);

        assertNotNull(response.getBody());
        assertTrue(drainBody(response).length > 0);
    }

    @Test
    void testSignPdfWithPem() throws Exception {
        MockMultipartFile pdfFile =
                new MockMultipartFile(
                        "fileInput", "test.pdf", MediaType.APPLICATION_PDF_VALUE, pdfBytes);
        MockMultipartFile keyFile =
                new MockMultipartFile(
                        "privateKeyFile", "test-key.pem", "application/x-pem-file", pemKeyBytes);
        MockMultipartFile certFile =
                new MockMultipartFile(
                        "certFile", "test-cert.pem", "application/x-pem-file", pemCertBytes);

        SignPDFWithCertRequest request = new SignPDFWithCertRequest();
        request.setFileInput(pdfFile);
        request.setCertType("PEM");
        request.setPrivateKeyFile(keyFile);
        request.setCertFile(certFile);
        request.setPassword("password");
        request.setShowSignature(false);
        request.setReason("test");
        request.setLocation("test");
        request.setName("tester");
        request.setPageNumber(1);
        request.setShowLogo(false);

        ResponseEntity<Resource> response = certSignController.signPDFWithCert(request);

        assertNotNull(response.getBody());
        assertTrue(drainBody(response).length > 0);
    }

    @Test
    void testSignPdfWithCrt() throws Exception {
        MockMultipartFile pdfFile =
                new MockMultipartFile(
                        "fileInput", "test.pdf", MediaType.APPLICATION_PDF_VALUE, pdfBytes);
        MockMultipartFile keyFile =
                new MockMultipartFile(
                        "privateKeyFile", "test-key.key", "application/x-pem-file", keyBytes);
        MockMultipartFile certFile =
                new MockMultipartFile(
                        "certFile", "test-cert.crt", "application/x-x509-ca-cert", crtCertBytes);

        SignPDFWithCertRequest request = new SignPDFWithCertRequest();
        request.setFileInput(pdfFile);
        request.setCertType("PEM");
        request.setPrivateKeyFile(keyFile);
        request.setCertFile(certFile);
        request.setPassword("password");
        request.setShowSignature(false);
        request.setReason("test");
        request.setLocation("test");
        request.setName("tester");
        request.setPageNumber(1);
        request.setShowLogo(false);

        ResponseEntity<Resource> response = certSignController.signPDFWithCert(request);

        assertNotNull(response.getBody());
        assertTrue(drainBody(response).length > 0);
    }

    @Test
    void testSignPdfWithCer() throws Exception {
        MockMultipartFile pdfFile =
                new MockMultipartFile(
                        "fileInput", "test.pdf", MediaType.APPLICATION_PDF_VALUE, pdfBytes);
        MockMultipartFile keyFile =
                new MockMultipartFile(
                        "privateKeyFile", "test-key.key", "application/x-pem-file", keyBytes);
        MockMultipartFile certFile =
                new MockMultipartFile(
                        "certFile", "test-cert.cer", "application/x-x509-ca-cert", cerCertBytes);

        SignPDFWithCertRequest request = new SignPDFWithCertRequest();
        request.setFileInput(pdfFile);
        request.setCertType("PEM");
        request.setPrivateKeyFile(keyFile);
        request.setCertFile(certFile);
        request.setPassword("password");
        request.setShowSignature(false);
        request.setReason("test");
        request.setLocation("test");
        request.setName("tester");
        request.setPageNumber(1);
        request.setShowLogo(false);

        ResponseEntity<Resource> response = certSignController.signPDFWithCert(request);

        assertNotNull(response.getBody());
        assertTrue(drainBody(response).length > 0);
    }

    @Test
    void testSignPdfWithDer() throws Exception {
        MockMultipartFile pdfFile =
                new MockMultipartFile(
                        "fileInput", "test.pdf", MediaType.APPLICATION_PDF_VALUE, pdfBytes);
        MockMultipartFile keyFile =
                new MockMultipartFile(
                        "privateKeyFile", "test-key.key", "application/x-pem-file", keyBytes);
        MockMultipartFile certFile =
                new MockMultipartFile(
                        "certFile", "test-cert.der", "application/x-x509-ca-cert", derCertBytes);

        SignPDFWithCertRequest request = new SignPDFWithCertRequest();
        request.setFileInput(pdfFile);
        request.setCertType("PEM");
        request.setPrivateKeyFile(keyFile);
        request.setCertFile(certFile);
        request.setPassword("password");
        request.setShowSignature(false);
        request.setReason("test");
        request.setLocation("test");
        request.setName("tester");
        request.setPageNumber(1);
        request.setShowLogo(false);

        ResponseEntity<Resource> response = certSignController.signPDFWithCert(request);

        assertNotNull(response.getBody());
        assertTrue(drainBody(response).length > 0);
    }
}
