package stirling.software.proprietary.security.controller.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import stirling.software.common.model.ApplicationProperties;
import stirling.software.proprietary.model.Team;
import stirling.software.proprietary.security.database.repository.UserRepository;
import stirling.software.proprietary.security.model.User;
import stirling.software.proprietary.security.model.api.user.UsernameAndPass;
import stirling.software.proprietary.security.repository.TeamRepository;
import stirling.software.proprietary.security.service.EmailService;
import stirling.software.proprietary.security.service.LoginAttemptService;
import stirling.software.proprietary.security.service.SaveUserRequest;
import stirling.software.proprietary.security.service.TeamService;
import stirling.software.proprietary.security.service.UserService;
import stirling.software.proprietary.security.session.SessionPersistentRegistry;
import stirling.software.proprietary.service.UserLicenseSettingsService;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

@ExtendWith(MockitoExtension.class)
class UserControllerTest {

    private final ObjectMapper objectMapper = JsonMapper.builder().build();

    @Mock private UserService userService;
    @Mock private SessionPersistentRegistry sessionRegistry;
    @Mock private TeamRepository teamRepository;
    @Mock private UserRepository userRepository;
    @Mock private EmailService emailService;
    @Mock private UserLicenseSettingsService licenseSettingsService;
    @Mock private LoginAttemptService loginAttemptService;

    private ApplicationProperties applicationProperties;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        applicationProperties = new ApplicationProperties();
        applicationProperties.getPremium().setMaxUsers(10);
        applicationProperties.getMail().setEnabled(true);

        UserController controller =
                new UserController(
                        userService,
                        sessionRegistry,
                        applicationProperties,
                        teamRepository,
                        userRepository,
                        Optional.of(emailService),
                        licenseSettingsService,
                        loginAttemptService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void registerRejectsExistingUser() throws Exception {
        UsernameAndPass payload = new UsernameAndPass();
        payload.setUsername("existing@example.com");
        payload.setPassword("secure-password");
        when(userService.usernameExistsIgnoreCase("existing@example.com")).thenReturn(true);

        mockMvc.perform(
                        post("/api/v1/user/register")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(payload)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("User already exists"));

        verify(userService, never()).saveUserCore(any());
    }

    @Test
    void registerRejectsMissingUsername() throws Exception {
        UsernameAndPass payload = new UsernameAndPass();
        payload.setPassword("secure-password");

        mockMvc.perform(
                        post("/api/v1/user/register")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(payload)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Username is required"));

        verify(userService, never()).saveUserCore(any());
    }

    @Test
    void registerCreatesUserWhenValid() throws Exception {
        UsernameAndPass payload = new UsernameAndPass();
        payload.setUsername("newuser");
        payload.setEmail("new@example.com");
        payload.setPassword("secure-password");
        Team defaultTeam = new Team();
        defaultTeam.setName(TeamService.DEFAULT_TEAM_NAME);

        when(userService.usernameExistsIgnoreCase("newuser")).thenReturn(false);
        when(userService.isUsernameValid("newuser")).thenReturn(true);
        when(userRepository.findByEmailIgnoreCase("new@example.com")).thenReturn(Optional.empty());
        when(licenseSettingsService.wouldExceedLimit(1)).thenReturn(false);
        when(teamRepository.findByName(TeamService.DEFAULT_TEAM_NAME))
                .thenReturn(Optional.of(defaultTeam));

        User savedUser = new User();
        savedUser.setUsername("newuser");
        savedUser.setEmail("new@example.com");
        savedUser.setEnabled(true);
        when(userService.saveUserCore(any())).thenReturn(savedUser);

        mockMvc.perform(
                        post("/api/v1/user/register")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(payload)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.user.username").value("newuser"));

        ArgumentCaptor<SaveUserRequest> requestCaptor =
                ArgumentCaptor.forClass(SaveUserRequest.class);
        verify(userService).saveUserCore(requestCaptor.capture());
        assertThat(requestCaptor.getValue().isEnabled()).isTrue();
        assertThat(requestCaptor.getValue().getEmail()).isEqualTo("new@example.com");
        assertThat(requestCaptor.getValue().getUsername()).isEqualTo("newuser");
    }

    @Test
    void registerRejectsMissingEmail() throws Exception {
        UsernameAndPass payload = new UsernameAndPass();
        payload.setUsername("newuser");
        payload.setPassword("secure-password");

        when(userService.usernameExistsIgnoreCase("newuser")).thenReturn(false);
        when(userService.isUsernameValid("newuser")).thenReturn(true);

        mockMvc.perform(
                        post("/api/v1/user/register")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(payload)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Email is required"));

        verify(userService, never()).saveUserCore(any());
    }

    @Test
    void changeUserEnabledPreventsSelfDisable() throws Exception {
        User user = new User();
        user.setUsername("admin");
        when(userService.usernameExistsIgnoreCase("admin")).thenReturn(true);
        when(userService.findByUsernameIgnoreCase("admin")).thenReturn(Optional.of(user));
        Authentication authentication = new UsernamePasswordAuthenticationToken("admin", "pw");

        mockMvc.perform(
                        post("/api/v1/user/admin/changeUserEnabled/admin")
                                .param("enabled", "false")
                                .principal(authentication))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Cannot disable your own account."));
    }

    @Test
    void changePasswordRejectsMissingUser() throws Exception {
        Authentication authentication = new UsernamePasswordAuthenticationToken("ghost", "pw");
        when(userService.usernameExistsIgnoreCase("ghost")).thenReturn(false);

        mockMvc.perform(post("/api/v1/user/admin/deleteUser/ghost").principal(authentication))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("User not found."));
    }

    @Test
    void unlockUserCallsResetAttemptsAndReturnsOk() throws Exception {
        mockMvc.perform(post("/api/v1/user/admin/unlockUser/lockeduser"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("User account unlocked successfully"));

        verify(loginAttemptService).resetAttempts("lockeduser");
    }

    @Test
    void defaultTeamUsersCannotEnumerateOtherAccounts() throws Exception {
        User self = directoryUser(1L, "self", TeamService.DEFAULT_TEAM_NAME, 1L);
        User stranger = directoryUser(2L, "stranger", TeamService.DEFAULT_TEAM_NAME, 1L);
        when(userRepository.findByUsernameIgnoreCase("self")).thenReturn(Optional.of(self));
        when(userRepository.findAll()).thenReturn(java.util.List.of(self, stranger));
        mockMvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                                        "/api/v1/user/users")
                                .principal(() -> "self"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].username").value("self"));
    }

    @Test
    void namedTeamsSeeOnlyEnabledTeammates() throws Exception {
        User self = directoryUser(1L, "self", "A", 2L);
        User teammate = directoryUser(2L, "teammate", "A", 2L);
        User disabled = directoryUser(3L, "disabled", "A", 2L);
        disabled.setEnabled(false);
        User stranger = directoryUser(4L, "stranger", "B", 3L);
        when(userRepository.findByUsernameIgnoreCase("self")).thenReturn(Optional.of(self));
        when(userRepository.findAll())
                .thenReturn(java.util.List.of(self, teammate, disabled, stranger));
        mockMvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                                        "/api/v1/user/users")
                                .principal(() -> "self"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void administratorsCanStillSelectAllEnabledUsers() throws Exception {
        User admin = directoryUser(1L, "admin", TeamService.DEFAULT_TEAM_NAME, 1L);
        admin.addAuthority(
                new stirling.software.proprietary.security.model.Authority("ROLE_ADMIN", admin));
        User other = directoryUser(2L, "other", "Other", 2L);
        when(userRepository.findByUsernameIgnoreCase("admin")).thenReturn(Optional.of(admin));
        when(userRepository.findAll()).thenReturn(java.util.List.of(admin, other));
        mockMvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                                        "/api/v1/user/users")
                                .principal(() -> "admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void unknownPrincipalCannotReadDirectory() throws Exception {
        mockMvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                                        "/api/v1/user/users")
                                .principal(() -> "unknown"))
                .andExpect(status().isUnauthorized());
        verify(userRepository, never()).findAll();
    }

    private static User directoryUser(Long id, String username, String teamName, Long teamId) {
        Team team = new Team();
        team.setId(teamId);
        team.setName(teamName);
        User user = new User();
        user.setId(id);
        user.setUsername(username);
        user.setEnabled(true);
        user.setTeam(team);
        return user;
    }

    @Test
    void registrationRejectsShortPasswordsBeforeCreatingUser() throws Exception {
        when(userService.isUsernameValid("newuser")).thenReturn(true);
        mockMvc.perform(
                        post("/api/v1/user/register")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"username\":\"newuser\",\"password\":\"short\",\"email\":\"new@example.com\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Password must be at least 6 characters"));
        verify(userService, never()).saveUserCore(any());
    }

    @Test
    void registrationRejectsDuplicateEmailsRegardlessOfCase() throws Exception {
        when(userService.isUsernameValid("newuser")).thenReturn(true);
        when(userRepository.findByEmailIgnoreCase("new@example.com"))
                .thenReturn(Optional.of(new User()));
        mockMvc.perform(
                        post("/api/v1/user/register")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"username\":\"newuser\",\"password\":\"secure-password\",\"email\":\"New@Example.COM\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Email already registered"));
        verify(userService, never()).saveUserCore(any());
    }

    @Test
    void registrationRejectsMalformedEmail() throws Exception {
        when(userService.isUsernameValid("newuser")).thenReturn(true);
        mockMvc.perform(
                        post("/api/v1/user/register")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"username\":\"newuser\",\"password\":\"secure-password\",\"email\":\"two@@example.com\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Invalid email format"));
        verify(userService, never()).saveUserCore(any());
    }
}
