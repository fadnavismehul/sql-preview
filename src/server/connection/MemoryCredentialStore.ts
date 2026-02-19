import { ICredentialStore } from './interfaces';

export class MemoryCredentialStore implements ICredentialStore {
  private secrets = new Map<string, string>();

  public async getPassword(profileId: string): Promise<string | undefined> {
    return this.secrets.get(profileId);
  }

  public async setPassword(profileId: string, password: string): Promise<void> {
    this.secrets.set(profileId, password);
  }

  public async deletePassword(profileId: string): Promise<void> {
    this.secrets.delete(profileId);
  }
}
