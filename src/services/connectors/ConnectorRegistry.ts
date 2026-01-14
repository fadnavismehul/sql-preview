import { IConnector } from './IConnector';

export class ConnectorRegistry {
  private connectors: Map<string, IConnector> = new Map();

  public register(name: string, connector: IConnector) {
    this.connectors.set(name, connector);
  }

  public get(name: string): IConnector | undefined {
    return this.connectors.get(name);
  }

  public getAvailableConnectors(): string[] {
    return Array.from(this.connectors.keys());
  }
}
