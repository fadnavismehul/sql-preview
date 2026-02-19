import { ConnectionProfile } from '../../common/types';
import { IProfileStore, ICredentialStore } from './interfaces';
import { logger } from '../ConsoleLogger';

export class ConnectionManager {
  constructor(
    private readonly profileStores: IProfileStore[],
    private readonly credentialStore: ICredentialStore
  ) {}

  /**
   * Returns all available connection profiles.
   * Profiles from earlier stores in the list override profiles with the same ID from later stores.
   */
  public async getProfiles(): Promise<ConnectionProfile[]> {
    const profileMap = new Map<string, ConnectionProfile>();

    // Iterate in reverse order so that earlier stores (higher priority) overwrite later ones
    for (let i = this.profileStores.length - 1; i >= 0; i--) {
      try {
        const profiles = await this.profileStores[i]!.loadProfiles();
        for (const profile of profiles) {
          profileMap.set(profile.id, profile);
        }
      } catch (e) {
        logger.error(`[ConnectionManager] Failed to load profiles from store index ${i}:`, e);
      }
    }

    return Array.from(profileMap.values());
  }

  /**
   * Retrieves a specific profile by ID, including its resolved password if available.
   */
  public async getProfile(id: string): Promise<ConnectionProfile | undefined> {
    const profiles = await this.getProfiles();
    const profile = profiles.find(p => p.id === id);

    if (!profile) {
      return undefined;
    }

    // Clone to avoid mutating cached objects
    const resolved = { ...profile };

    // Inject Password if not already present
    if (!resolved.password) {
      try {
        const password = await this.credentialStore.getPassword(id);
        if (password) {
          resolved.password = password;
        }
      } catch (e) {
        logger.warn(`[ConnectionManager] Failed to retrieve password for ${id}:`, e);
      }
    }

    return resolved;
  }

  /**
   * Saves a profile to the first writable store.
   * Credentials are stripped and saved to the CredentialStore.
   */
  public async saveProfile(profile: ConnectionProfile): Promise<void> {
    const writableStore = this.profileStores.find(s => !s.isReadOnly);
    if (!writableStore) {
      throw new Error('No writable profile store available.');
    }

    // 1. Handle Password
    if (profile.password) {
      await this.credentialStore.setPassword(profile.id, profile.password);
    } else {
      // If password field is explicitly empty string, maybe clear it?
      // Or if undefined, do nothing (maybe preserving existing?)
      // Current behavior in FileConnectionManager was: if empty string, delete.
      if (profile.password === '') {
        await this.credentialStore.deletePassword(profile.id);
      }
    }

    // 2. Save Profile (Strip/Redact password)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...safeProfile } = profile;
    await writableStore.saveProfile(safeProfile as ConnectionProfile);
  }

  /**
   * Deletes a profile and its credentials.
   */
  public async deleteProfile(id: string): Promise<void> {
    // We should probably delete from ALL writable stores?
    // Or just the first one?
    // RFC didn't specify, but safer to try deleting from all writable to ensure cleanup.
    // But practically, we usually have one writable store (File).

    for (const store of this.profileStores) {
      if (!store.isReadOnly) {
        // Try to delete. Store implementation should handle if ID not found gracefully?
        // Our FileProfileStore does filter logic, so it's safe.
        await store.deleteProfile(id);
      }
    }

    await this.credentialStore.deletePassword(id);
  }
}
