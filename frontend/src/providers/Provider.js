export default class Provider {
  constructor({ id, name, kind = 'external-socket' }) {
    this.id = id;
    this.name = name;
    this.kind = kind;
  }

  supportsMarket() {
    return false;
  }

  connect() {
    return {
      disconnect: () => {}
    };
  }

  async fetchHistory() {
    return [];
  }
}
