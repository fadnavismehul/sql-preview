import { ConnectionProfile } from '../../common/types';

/**
 * Interface for a store that provides connection profiles.
 * Examples: File (config.json), Environment Variables, Workspace Settings.
 */
export interface IProfileStore {
  /**
   * Returns all profiles known to this store.
   * Note: These profiles may NOT have resolved credentials yet.
   */
  loadProfiles(): Promise<ConnectionProfile[]>;

  /**
   * Persists a profile (if the store supports writing).
   * @throws Error if the store is read-only.
   */
  saveProfile(profile: ConnectionProfile): Promise<void>;

  /**
   * Deletes a profile.
   * @throws Error if the store is read-only.
   */
  deleteProfile(id: string): Promise<void>;

  /**
   * Whether this store supports saving/deleting profiles.
   */
  readonly isReadOnly: boolean;
}

/**
 * Interface for a secure credential store.
 * Examples: Keytar (System Keychain), Memory (Headless/Dev), Command (Shell).
 */
export interface ICredentialStore {
  /**
   * Retrieves a password for a given profile ID.
   */
  getPassword(profileId: string): Promise<string | undefined>;

  /**
   * Sets a password for a given profile ID.
   */
  setPassword(profileId: string, password: string): Promise<void>;

  /**
   * Deletes a password for a given profile ID.
   */
  deletePassword(profileId: string): Promise<void>;
}
