import bowser from 'bowser'
import BigNumber from 'bignumber.js'
import { get } from 'svelte/store'

import { app } from './stores'
import { WalletInterface, Ens } from './interfaces'

export function getNetwork(provider: any): Promise<number | any> {
  return new Promise((resolve, reject) => {
    const options = {
      jsonrpc: '2.0',
      method: 'net_version',
      params: [],
      id: 42
    }

    // use MetaMask parameter if there
    if (provider.chainId) {
      return resolve(Number(provider.chainId))
    }

    const callback = (e: any, res: any) => {
      e && reject(e)
      const result = res && res.result
      resolve(result && Number(result))
    }

    if (typeof provider.sendAsync === 'function') {
      provider.sendAsync(options, callback)
    } else if (typeof provider.send === 'function') {
      provider.send(options, callback)
    } else {
      resolve(null)
    }
  })
}

export function getAddress(provider: any): Promise<string | any> {
  return new Promise((resolve, reject) => {
    const options = {
      jsonrpc: '2.0',
      method: 'eth_accounts',
      params: [],
      id: 42
    }

    // use MetaMask request method if there
    if (provider.request) {
      return provider.request(options).then((res: string[]) => {
        return resolve(res[0])
      })
    }

    const callback = (e: any, res: any) => {
      e && reject(e)
      const result = res && res.result && res.result[0]
      resolve(result)
    }

    if (typeof provider.sendAsync === 'function') {
      provider.sendAsync(options, callback)
    } else if (typeof provider.send === 'function') {
      provider.send(options, callback)
    } else {
      resolve(null)
    }
  })
}

export async function getEns(provider: any, address: string): Promise<Ens> {
  const { networkId } = get(app)
  try {
    // There is an issue with ens and ts unable to find the
    // declaration file for it even though it is present.
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    // @ts-ignore - TS7016
    const { default: ENS, getEnsAddress } = await import('@ensdomains/ensjs')
    const ens = new ENS({ provider, ensAddress: getEnsAddress(networkId) })
    const { name } = await ens.getName(address)
    const nameInterface = await ens.name(name)
    const contentHash = await nameInterface?.getContent()
    const avatar = await nameInterface?.getText('avatar')
    return {
      name,
      avatar,
      contentHash,
      getText: nameInterface?.getText.bind(nameInterface)
    }
  } catch (e) {
    // Error getting ens
    console.error(e)
    return {}
  }
}

export function getBalance(
  provider: any,
  address?: string
): Promise<string | any> {
  return new Promise(async (resolve, reject) => {
    const currentAddress = address || (await getAddress(provider))

    if (!currentAddress) {
      resolve(null)
      return
    }

    const options = {
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [currentAddress, 'latest'],
      id: 42
    }

    // use MetaMask request method if there
    if (provider.request) {
      return provider
        .request(options)
        .then((res: string) => (res ? new BigNumber(res).toString(10) : null))
        .then(resolve)
    }

    const callback = (e: any, res: any) => {
      e && reject(e)
      const result = res && res.result
      resolve(result && new BigNumber(result).toString(10))
    }

    if (typeof provider.sendAsync === 'function') {
      provider.sendAsync(options, callback)
    } else if (typeof provider.send === 'function') {
      provider.send(options, callback)
    } else {
      resolve(null)
    }
  })
}

export function createModernProviderInterface(provider: any): WalletInterface {
  provider.autoRefreshOnNetworkChange = false

  const onFuncExists = typeof provider.on === 'function'

  interface ProviderEventHandlers {
    accountsChanged: ((arg: string[]) => void) | null
    networkChanged: ((arg: string | number) => void) | null
    chainChanged: ((arg: string | number) => void) | null
  }

  // A map of provider event handlers -- refferences needed
  // in order to remove the event listners when their no longer needed
  const providerEventHandler: ProviderEventHandlers = {
    accountsChanged: null,
    networkChanged: null,
    chainChanged: null
  }

  return {
    address: onFuncExists
      ? {
          onChange: func => {
            providerEventHandler['accountsChanged'] = (accounts: string[]) => {
              func(accounts && accounts[0])
            }

            // get the initial value
            getAddress(provider).then(func)
            provider.on(
              'accountsChanged',
              providerEventHandler['accountsChanged']
            )
          }
        }
      : {
          get: () => getAddress(provider)
        },
    network: onFuncExists
      ? {
          onChange: (func: (val: string | number) => void) => {
            providerEventHandler['networkChanged'] = (netId: string | number) =>
              func(netId && Number(netId))

            // We clone the previous handler in order to get a distinct refference
            // to the 'chainChanged' event handler
            providerEventHandler['chainChanged'] = providerEventHandler[
              'networkChanged'
            ].bind({})

            // get initial value
            getNetwork(provider).then(func)

            // networkChanged event is deprecated in MM, keep for wallets that may not have updated
            provider.on(
              'networkChanged',
              providerEventHandler['networkChanged']
            )

            // use new chainChanged event for network change
            provider.on('chainChanged', providerEventHandler['chainChanged'])
          }
        }
      : { get: () => getNetwork(provider) },
    balance: {
      get: () => getBalance(provider)
    },
    connect: async () => {
      try {
        if (provider.request) {
          const result = await provider.request({
            method: 'eth_requestAccounts'
          })
          return result
        } else {
          const result = await provider.enable()
          return result
        }
      } catch (e) {
        throw {
          message: 'This dapp requires access to your account information.'
        }
      }
    },
    disconnect: () => {
      if (provider?.removeListener) {
        // Iterate over the event handlers and remove them from the event listener.
        for (const [key, handler] of Object.entries(providerEventHandler)) {
          // If the handler is null, this indicates that no event listener was created
          if (handler) {
            provider.removeListener(key, handler)
          }
        }
      }
    },
    name: getProviderName(provider)
  }
}

export function createLegacyProviderInterface(provider: any): WalletInterface {
  return {
    address: {
      get: () => getAddress(provider)
    },
    network: {
      get: () => getNetwork(provider)
    },
    balance: {
      get: () => getBalance(provider)
    },
    name: getProviderName(provider)
  }
}

export function getProviderName(provider: any): string | undefined {
  if (!provider) return

  if (provider.isMathWallet) {
    return 'MathWallet'
  }

  if (provider.isDIDWallet) {
    return 'DIDWallet'
  }

  if (provider.isWalletIO) {
    return 'wallet.io'
  }

  if (provider.isDcentWallet) {
    return "D'CENT"
  }

  if (provider.isTokenPocket) {
    return 'TokenPocket'
  }

  if (provider.isOwnbit) {
    return 'Ownbit'
  }

  if (provider.wallet === 'MEETONE') {
    return 'MEETONE'
  }

  if (provider.isTorus) {
    return 'Torus'
  }

  if (provider.isImToken) {
    return 'imToken'
  }

  if (provider.isDapper) {
    return 'Dapper'
  }

  if (provider.isWalletConnect) {
    return 'WalletConnect'
  }

  if (provider.isTrust) {
    return 'Trust'
  }

  if (provider.isCoinbaseWallet) {
    return 'Coinbase'
  }

  if (provider.isOpera) {
    return 'Opera'
  }

  if (provider.isStatus) {
    return 'Status'
  }

  if (provider.isXDEFI) {
    return 'XDEFI'
  }

  if (provider.isTally) {
    return 'Tally'
  }

  if (provider.isTokenary) {
    return 'Tokenary'
  }

  if (provider.isFrame) {
    return 'Frame'
  }

  if (provider.isMYKEY) {
    return 'MYKEY'
  }

  if (provider.isHbWallet) {
    return 'huobiwallet'
  }

  if (provider.isHyperPay) {
    return 'HyperPay'
  }

  if (provider.isAToken) {
    return 'AToken'
  }

  if (provider.isLiquality) {
    return 'Liquality'
  }

  if (provider.isAlphaWallet) {
    return 'AlphaWallet'
  }

  if (provider.isBitpie) {
    return 'Bitpie'
  }

  if (provider.isTp) {
    return 'tp'
  }

  if (provider.isBlockWallet) {
    return 'BlockWallet'
  }

  if (provider.isOneInchIOSWallet) {
    return '1inch'
  }

  // =====================================
  // When adding new wallet place above this metamask check as some providers
  // have an isMetaMask property in addition to the wallet's own `is[WalletName]`

  if (provider.isMetaMask && provider._metamask) {
    return 'MetaMask'
  }

  if (provider.host && provider.host.indexOf('localhost') !== -1) {
    return 'localhost'
  }
}

export function getDeviceInfo() {
  const parsed = bowser.getParser(window.navigator.userAgent)
  const os = parsed.getOS()
  const browser = parsed.getBrowser()
  const { type } = parsed.getPlatform()

  return {
    isMobile: type ? type !== 'desktop' : window.innerWidth < 600,
    os,
    browser
  }
}

export function networkName(id: number): string {
  const { networkName, networkId } = get(app)
  return networkId === id && networkName
    ? networkName
    : (
        {
          1: 'mainnet',
          3: 'ropsten',
          4: 'rinkeby',
          5: 'goerli',
          28: 'boba-rinkeby',
          42: 'kovan',
          56: 'bsc',
          100: 'xdai',
          137: 'polygon',
          288: 'boba-mainnet',
          250: 'fantom-opera',
          4002: 'fantom-testnet'
        } as { [key: number]: string }
      )[id] || 'unknown'
}

export function wait(time: number) {
  return new Promise(resolve => setTimeout(resolve, time))
}

export function makeCancelable(promise: any) {
  let rejectFn: any

  const wrappedPromise: any = new Promise((resolve, reject) => {
    rejectFn = reject

    promise.then(resolve).catch(reject)
  })

  wrappedPromise.cancel = () => {
    rejectFn('canceled')
  }

  return wrappedPromise
}

export function isPromise(val: any): val is Promise<any> {
  if ((val as Promise<any>) instanceof Promise) {
    return true
  }
  return false
}

export function createInterval(func: any, interval: number) {
  const id = setInterval(func, interval)
  const status = { active: true }

  return {
    status,
    clear: () => {
      clearInterval(id)
      status.active = false
    }
  }
}

export function openLink(url: string) {
  window.open(url)
}
