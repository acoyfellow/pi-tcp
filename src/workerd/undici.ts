const unavailable = (name: string) =>
  class {
    constructor() {
      throw new Error(`undici.${name} is not available in workerd`);
    }
  };

export const Client = unavailable('Client');
export const Pool = unavailable('Pool');
export const EnvHttpProxyAgent = unavailable('EnvHttpProxyAgent');
export const setGlobalDispatcher = (): void => undefined;
export const install = undefined;
