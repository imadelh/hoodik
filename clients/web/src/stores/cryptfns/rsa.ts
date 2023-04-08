import RSA from 'node-rsa'
import { Buffer } from 'buffer'
import * as forge from 'node-forge'
import { aes } from '.'

const RSA_BYTES = 1024
const ENVIRONMENT = 'browser'
const PRIVATE_KEY_FORMAT: RSA.FormatPem = 'pkcs1'
const PUBLIC_KEY_FORMAT: RSA.FormatPem = 'pkcs1-public-pem'
const SIGNING_SCHEME = 'pss-sha256'
const RSA_OPTIONS: RSA.Options = {
  environment: ENVIRONMENT,
  signingScheme: SIGNING_SCHEME
}
const ENCRYPTION_SCHEME_PKCS1: RSA.AdvancedEncryptionSchemePKCS1 = {
  scheme: 'pkcs1',
  padding: 1
}

export interface Raw extends RSA {
  input?: string
}

export type Encoding = RSA.Encoding
export type Data = RSA.Data

export interface EncryptionData {
  message: Data
  encoding?: Encoding
}

export interface KeyPair {
  /**
   * Private RSA key string
   */
  input: string | null

  /**
   * The RSA key
   */
  key: Raw | null

  /**
   * Public RSA key string
   */
  publicKey: string | null

  /**
   * Fingerprint of the public key
   */
  fingerprint: string | null
}

/**
 * Decrypt a private key
 * @throws
 */
export async function decryptPrivateKey(encrypted: string, passphrase: string): Promise<string> {
  // Unfortunately this doesn't work in the browser :(
  // return crypto
  //   .createPrivateKey({
  //     encrypted,
  //     type: 'pkcs1',
  //     format: 'pem',
  //     passphrase
  //   })
  //   .export({ type: 'pkcs1', format: 'pem' }) as string

  return aes.decrypt(encrypted, passphrase)
}

/**
 * Protect private key with passphrase
 * @throws
 */
export async function protectPrivateKey(unencrypted: string, passphrase: string): Promise<string> {
  // Unfortunately this doesn't work in the browser :(
  // return crypto
  //   .createPrivateKey({
  //     unencrypted,
  //     passphrase
  //   })
  //   .export({ type: 'pkcs1', format: 'pem', cipher: 'aes128', passphrase }) as string

  return aes.encrypt(unencrypted, passphrase)
}

/**
 * Convert input to raw
 */
export async function inputToKeyPair(input: string): Promise<KeyPair> {
  const key: Raw = new RSA({ b: RSA_BYTES }).importKey(input, PRIVATE_KEY_FORMAT)
  key.setOptions(RSA_OPTIONS)

  key.input = input

  const publicKey = key.exportKey(PUBLIC_KEY_FORMAT)
  const fingerprint = await getFingerprintFromRaw(key)

  return {
    key,
    publicKey,
    input,
    fingerprint
  }
}

/**
 * Generate KeyPair from public key, this can only be used to verify signatures
 */
export async function publicToKeyPair(publicKey: string): Promise<KeyPair> {
  const key = new RSA(publicKey, PUBLIC_KEY_FORMAT, RSA_OPTIONS)

  return { key, publicKey, input: null, fingerprint: await getFingerprintFromRaw(key) }
}

/**
 * Generate key id from string
 *
 * @throws
 */
export async function getFingerprint(input: string): Promise<string> {
  try {
    const { key } = await publicToKeyPair(input)

    if (!key) {
      throw new Error('Not public key, or not a public key')
    }

    return getFingerprintFromRaw(key)
  } catch (e) {
    const { publicKey } = await inputToKeyPair(input)

    if (!publicKey) {
      throw new Error(`Not a public key or a private key, upstream error: ${e}`)
    }

    const { key } = await publicToKeyPair(publicKey)

    if (!key) {
      throw new Error(`Not a public key or a private key, upstream error: ${e}`)
    }

    return getFingerprintFromRaw(key)
  }
}

/**
 * Generate a key id from given raw key
 */
export async function getFingerprintFromRaw(key: Raw): Promise<string> {
  const { n } = key.exportKey('components-public')

  const newN = Array.prototype.map.call(n, (byte) => byte as number) as number[]
  newN.shift()
  const buffer = Buffer.from(newN)

  return forge.md.sha256.create().update(buffer.toString('hex'), 'raw').digest().toHex()
}

/**
 * Generate a random input in a format of KeyPair
 */
export async function generateKeyPair(): Promise<KeyPair> {
  return inputToKeyPair(new RSA({ b: RSA_BYTES }).generateKeyPair().exportKey(PRIVATE_KEY_FORMAT))
}

/**
 * Generate a KeyPair from input
 */
export async function keypairFromRaw(internal: KeyPair): Promise<KeyPair> {
  const { key, publicKey } = internal

  let fingerprint = null

  if (publicKey) {
    fingerprint = await getFingerprint(publicKey)
  }

  return {
    input: key?.input || null,
    key,
    publicKey,
    fingerprint
  }
}

/**
 * Sign the given message with current secret key and return an object with signature and publicKey
 */
export async function sign(kp: KeyPair, message: string): Promise<string> {
  const { key } = kp

  if (!key || !key.isPrivate()) {
    throw new Error('No privateKey, cannot sign message')
  }

  return key.sign(message, 'hex')
}

/**
 * Verify the message with the given public key or the stored one
 */
export async function verify(
  signature: string,
  message: string,
  publicKey: string
): Promise<boolean> {
  const { key } = await publicToKeyPair(publicKey)

  if (!key) {
    throw new Error('No publicKey, cannot verify message')
  }

  return key.verify(message, Buffer.from(signature, 'hex'))
}

/**
 * Encrypt a message with given public key
 */
export async function encryptMessage(message: string, publicKey: string): Promise<string> {
  const { key } = await publicToKeyPair(publicKey as string)

  if (!key) {
    throw new Error('No publicKey, cannot encrypt message')
  }

  if (!key.isPublic()) {
    throw new Error('Key is not public, cannot encrypt message')
  }

  key.setOptions({
    encryptionScheme: ENCRYPTION_SCHEME_PKCS1
  })

  return key.encrypt(message, 'base64')
}

/**
 * Decrypt a message with stored private key
 */
export async function decryptMessage(kp: KeyPair, message: string): Promise<string> {
  const { key } = kp

  if (!key || !key.isPrivate()) {
    throw new Error('No privateKey, cannot decrypt message')
  }

  key.setOptions({
    encryptionScheme: ENCRYPTION_SCHEME_PKCS1
  })

  return key.decrypt(Buffer.from(message, 'base64'), 'utf8')
}
