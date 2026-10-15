package stirling.software.proprietary.security.controller.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Properties;
import java.util.stream.Stream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.scheduling.annotation.AsyncAnnotationBeanPostProcessor;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;

import stirling.software.common.model.ApplicationProperties;
import stirling.software.proprietary.security.model.api.Email;
import stirling.software.proprietary.security.service.EmailService;

@ExtendWith(MockitoExtension.class)
class EmailControllerTest {

    private MockMvc mockMvc;

    @Mock private EmailService emailService;

    @InjectMocks private EmailController emailController;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(emailController).build();
    }

    @ParameterizedTest(name = "Case {index}: exception={0}, includeTo={1}")
    @MethodSource("emailParams")
    void shouldHandleEmailRequests(
            Exception serviceException,
            boolean includeTo,
            int expectedStatus,
            String expectedContent)
            throws Exception {
        if (serviceException == null) {
            doNothing().when(emailService).sendEmailWithAttachment(any(Email.class));
        } else {
            doThrow(serviceException).when(emailService).sendEmailWithAttachment(any(Email.class));
        }

        var request =
                multipart("/api/v1/general/send-email")
                        .file("fileInput", "dummy-content".getBytes())
                        .param("subject", "Test Email")
                        .param("body", "This is a test email.");

        if (includeTo) {
            request = request.param("to", "test@example.com");
        }

        mockMvc.perform(request)
                .andExpect(status().is(expectedStatus))
                .andExpect(content().string(expectedContent));
    }

    @Test
    void smtpFailureIsReturnedBeforeRequestCleanupWithAsyncSupportEnabled() throws Exception {
        JavaMailSender sender = mock(JavaMailSender.class);
        when(sender.createMimeMessage())
                .thenReturn(new MimeMessage(Session.getInstance(new Properties())));
        doThrow(new MailSendException("SMTP unavailable"))
                .when(sender)
                .send(any(MimeMessage.class));
        ApplicationProperties properties = new ApplicationProperties();
        properties.getMail().setFrom("AziralPDF <no-reply@example.com>");

        try (GenericApplicationContext context = new GenericApplicationContext()) {
            context.registerBean(AsyncAnnotationBeanPostProcessor.class);
            context.registerBean(EmailService.class, () -> new EmailService(sender, properties));
            context.refresh();
            MockMvc mvc =
                    MockMvcBuilders.standaloneSetup(
                                    new EmailController(context.getBean(EmailService.class)))
                            .build();
            mvc.perform(
                            multipart("/api/v1/general/send-email")
                                    .file(
                                            new MockMultipartFile(
                                                    "fileInput",
                                                    "report.pdf",
                                                    "application/pdf",
                                                    "test".getBytes()))
                                    .param("to", "test@example.com")
                                    .param("subject", "Test")
                                    .param("body", "Test attachment"))
                    .andExpect(status().isInternalServerError())
                    .andExpect(content().string("SMTP unavailable"));
        }
    }

    static Stream<Arguments> emailParams() {
        return Stream.of(
                // success case
                Arguments.of(null, true, 200, "Email sent successfully"),
                // generic messaging error
                Arguments.of(
                        new MessagingException("Failed to send email"),
                        true,
                        500,
                        "Failed to send email: Failed to send email"),
                // missing 'to' results in MailSendException
                Arguments.of(
                        new MailSendException("Invalid Addresses"),
                        false,
                        500,
                        "Invalid Addresses"),
                // invalid email address formatting
                Arguments.of(
                        new MessagingException("Invalid Addresses"),
                        true,
                        500,
                        "Failed to send email: Invalid Addresses"));
    }
}
