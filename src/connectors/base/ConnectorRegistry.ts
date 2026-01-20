import { IConnector } from './IConnector';

export class ConnectorRegistry {
  private connectors: Map<string, IConnector> = new Map();

  public register(connector: IConnector) {
    this.connectors.set(connector.id, connector);
  }

  public get(id: string): IConnector | undefined {
    return this.connectors.get(id);
  }

  public getAvailableConnectors(): string[] {
    return Array.from(this.connectors.keys());
  }
}
