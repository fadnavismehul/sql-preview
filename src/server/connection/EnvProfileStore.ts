import { ConnectionProfile } from '../../common/types';
import { IProfileStore } from './interfaces';
import { logger } from '../ConsoleLogger';

export class EnvProfileStore implements IProfileStore {
  public readonly isReadOnly = true;

  public async loadProfiles(): Promise<ConnectionProfile[]> {
    const envVar = process.env['SQL_PREVIEW_CONNECTIONS'];
    if (!envVar) {
      return [];
    }

    try {
      const parsed = JSON.parse(envVar);
      if (Array.isArray(parsed)) {
        // Basic validation could happen here
        return parsed as ConnectionProfile[];
      } else {
        logger.warn('[EnvProfileStore] SQL_PREVIEW_CONNECTIONS is not an array.');
        return [];
      }
    } catch (error) {
      logger.error('[EnvProfileStore] Failed to parse SQL_PREVIEW_CONNECTIONS JSON:', error);
      return [];
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async saveProfile(_profile: ConnectionProfile): Promise<void> {
    throw new Error('EnvProfileStore is read-only.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async deleteProfile(_id: string): Promise<void> {
    throw new Error('EnvProfileStore is read-only.');
  }
}
