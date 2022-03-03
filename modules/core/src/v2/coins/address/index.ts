import { BaseCoin } from '../..';
import { InvalidAddressError } from '../../../errors';


export function isSameBaseAddress(coin: BaseCoin, address: string, baseAddress: string): boolean {
  if (!coin.isValidAddress(address)) {
    throw new InvalidAddressError(`invalid address: ${address}`);
  }
  return coin.getBaseAddress(address) === coin.getBaseAddress(baseAddress);
}
