package stirling.software.proprietary.security.controller.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authorization.AuthorizationDeniedException;

class SecurityExceptionHandlerTest {
    @Test
    void methodSecurityDenialReturnsForbiddenWithoutInternalDetails() {
        var request = new MockHttpServletRequest("POST", "/api/v1/license/admin/assign");
        var result =
                new SecurityExceptionHandler()
                        .handleAccessDenied(
                                new AuthorizationDeniedException("internal rule details"), request);
        assertThat(result.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(result.getBody().getStatus()).isEqualTo(403);
        assertThat(result.getBody().getDetail()).doesNotContain("internal rule details");
    }
}
