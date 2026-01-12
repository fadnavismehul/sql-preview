import * as vscode from 'vscode';

export class AuthManager {
  private static readonly PASSWORD_SECRET_KEY = 'sqlPreview.database.password';

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Securely retrieves the stored password from VS Code's secret storage
   */
  async getPassword(): Promise<string | undefined> {
    return await this.context.secrets.get(AuthManager.PASSWORD_SECRET_KEY);
  }

  /**
   * Securely stores the password in VS Code's secret storage
   */
  async setPassword(password: string): Promise<void> {
    await this.context.secrets.store(AuthManager.PASSWORD_SECRET_KEY, password);
    await this.updatePasswordStatus();
  }

  /**
   * Clears the stored password from VS Code's secret storage
   */
  async clearPassword(): Promise<void> {
    await this.context.secrets.delete(AuthManager.PASSWORD_SECRET_KEY);
    await this.updatePasswordStatus();
  }

  /**
   * Generates the Basic Auth header value if a password is set
   */
  async getBasicAuthHeader(user: string): Promise<string | undefined> {
    const password = await this.getPassword();
    if (password) {
      return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
    }
    return undefined;
  }

  /**
   * Updates the password status display in settings
   */
  async updatePasswordStatus(): Promise<void> {
    const config = vscode.workspace.getConfiguration('sqlPreview');
    const hasPassword = (await this.getPassword()) !== undefined;

    // Update the display value in settings
    await config.update(
      'password',
      hasPassword ? '[Password Set]' : '',
      vscode.ConfigurationTarget.Global
    );
  }
}
