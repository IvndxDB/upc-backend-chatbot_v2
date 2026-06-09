/**
 * Cognito Service — direct USER_PASSWORD_AUTH flow
 * Requiere que el App Client tenga habilitado "ALLOW_USER_PASSWORD_AUTH"
 * y NO tenga client secret (public client).
 */

const COGNITO_CONFIG = {
  region: 'us-east-1',
  userPoolId: 'us-east-1_rQThsc99E',
  clientId: '5fnkj569pk2qnf4cbga2plj14p',
  requiredGroup: 'addon', // solo usuarios de este grupo pueden entrar
};

const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_CONFIG.region}.amazonaws.com/`;
const SESSION_KEY = 'cognitoSession';

const ERROR_MESSAGES = {
  NotAuthorizedException: 'Usuario o contraseña incorrectos.',
  UserNotFoundException: 'Usuario no encontrado.',
  UserNotConfirmedException: 'Cuenta no confirmada. Revisa tu correo.',
  PasswordResetRequiredException: 'Debes restablecer tu contraseña.',
  TooManyRequestsException: 'Demasiados intentos. Espera unos minutos.',
  InvalidParameterException: 'Datos inválidos. Verifica tu usuario y contraseña.',
};

async function _cognitoRequest(target, body) {
  return fetch(COGNITO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
}

function _decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

const cognitoService = {
  async signIn(username, password) {
    const res = await _cognitoRequest('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CONFIG.clientId,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      const type = data.__type || data.code || '';
      const msg = ERROR_MESSAGES[type] || data.message || 'Error de autenticación.';
      throw new Error(msg);
    }

    const auth = data.AuthenticationResult;

    // Verificar que el usuario pertenezca al grupo requerido
    const payload = _decodeJwtPayload(auth.IdToken);
    const groups = payload?.['cognito:groups'] || [];
    if (!groups.includes(COGNITO_CONFIG.requiredGroup)) {
      throw new Error('No tienes acceso a esta aplicación. Contacta al administrador.');
    }

    const session = {
      accessToken: auth.AccessToken,
      idToken: auth.IdToken,
      refreshToken: auth.RefreshToken,
      expiresAt: Date.now() + auth.ExpiresIn * 1000,
    };
    await chrome.storage.local.set({ [SESSION_KEY]: session });
    return session;
  },

  async getSession() {
    const stored = await chrome.storage.local.get(SESSION_KEY);
    return stored[SESSION_KEY] || null;
  },

  async isLoggedIn() {
    const session = await this.getSession();
    if (!session) return false;
    // Token válido con 60s de margen
    if (Date.now() < session.expiresAt - 60_000) return true;
    // Expirado → intentar refresh
    return this._refreshSession(session.refreshToken);
  },

  async _refreshSession(refreshToken) {
    try {
      const res = await _cognitoRequest('InitiateAuth', {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: COGNITO_CONFIG.clientId,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      });
      const data = await res.json();
      if (!res.ok) throw new Error('refresh failed');

      const auth = data.AuthenticationResult;

      // Re-verificar grupo en cada refresh
      const payload = _decodeJwtPayload(auth.IdToken);
      const groups = payload?.['cognito:groups'] || [];
      if (!groups.includes(COGNITO_CONFIG.requiredGroup)) {
        await this.signOut();
        return false;
      }

      const session = await this.getSession();
      const updated = {
        ...session,
        accessToken: auth.AccessToken,
        idToken: auth.IdToken,
        expiresAt: Date.now() + auth.ExpiresIn * 1000,
      };
      await chrome.storage.local.set({ [SESSION_KEY]: updated });
      return true;
    } catch {
      await this.signOut();
      return false;
    }
  },

  async signOut() {
    await chrome.storage.local.remove(SESSION_KEY);
  },

  async getCurrentUser() {
    const session = await this.getSession();
    if (!session) return null;
    const payload = _decodeJwtPayload(session.idToken);
    if (!payload) return null;
    return {
      email: payload.email || payload['cognito:username'] || '',
      name: payload.name || payload.given_name || '',
      sub: payload.sub || '',
    };
  },
};
