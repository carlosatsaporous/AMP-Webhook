import crypto from 'crypto';
import fetch from 'node-fetch';
import { AmpSignatureValidation } from '../types';
import { logger } from '../utils/logger';

/**
 * AMP Signature Validator
 * Validates AMP form submissions using Google's public keys
 */
export class AmpValidator {
  private publicKeys: Map<string, string> = new Map();
  private lastKeyFetch: number = 0;
  private readonly KEY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly AMP_PUBLIC_KEYS_URL = 'https://cdn.ampproject.org/certs/signing_certs.json';

  /**
   * Validate AMP signature from request headers
   */
  async validateSignature(
    body: string,
    signature: string,
    timestamp: string
  ): Promise<AmpSignatureValidation> {
    try {
      // Check if signature format is valid
      if (!signature || !signature.startsWith('rsa-sha256=')) {
        return {
          isValid: false,
          error: 'Invalid signature format. Expected rsa-sha256= prefix'
        };
      }

      // Extract signature data
      const signatureData = signature.replace('rsa-sha256=', '');
      const signatureBuffer = Buffer.from(signatureData, 'base64');

      // Check timestamp (should be within 5 minutes)
      const timestampMs = parseInt(timestamp) * 1000;
      const now = Date.now();
      const timeDiff = Math.abs(now - timestampMs);
      const maxTimeDiff = 5 * 60 * 1000; // 5 minutes

      if (timeDiff > maxTimeDiff) {
        return {
          isValid: false,
          error: `Timestamp too old. Difference: ${timeDiff}ms, Max allowed: ${maxTimeDiff}ms`
        };
      }

      // Ensure we have fresh public keys
      await this.ensurePublicKeys();

      // Create the message to verify (timestamp + body)
      const message = timestamp + body;
      const messageBuffer = Buffer.from(message, 'utf8');

      // Try to verify with each public key
      for (const [keyId, publicKey] of this.publicKeys) {
        try {
          const verifier = crypto.createVerify('RSA-SHA256');
          verifier.update(messageBuffer);
          
          const isValid = verifier.verify(publicKey, signatureBuffer);
          
          if (isValid) {
            logger.info('AMP signature validated successfully', { keyId });
            return {
              isValid: true,
              publicKey: keyId
            };
          }
        } catch (keyError) {
          logger.warn('Failed to verify with key', { keyId, error: (keyError as any)?.message || 'Unknown error' });
          continue;
        }
      }

      return {
        isValid: false,
        error: 'Signature verification failed with all available public keys'
      };

    } catch (error) {
      logger.error('AMP signature validation error', { error: (error as any)?.message || 'Unknown error' });
      return {
        isValid: false,
        error: `Validation error: ${(error as any)?.message || 'Unknown error'}`
      };
    }
  }

  /**
   * Ensure we have fresh public keys from Google
   */
  private async ensurePublicKeys(): Promise<void> {
    const now = Date.now();
    
    // Check if we need to refresh keys
    if (this.publicKeys.size > 0 && (now - this.lastKeyFetch) < this.KEY_CACHE_TTL) {
      return;
    }

    try {
      logger.info('Fetching AMP public keys from Google');
      
      const response = await fetch(this.AMP_PUBLIC_KEYS_URL, {
        headers: {
          'User-Agent': 'AMP-Webhook-Validator/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch public keys: ${response.status} ${response.statusText}`);
      }

      const keysData = await response.json() as any;
      
      if (!keysData.keys || !Array.isArray(keysData.keys)) {
        throw new Error('Invalid public keys response format');
      }

      // Clear old keys and add new ones
      this.publicKeys.clear();
      
      for (const keyData of keysData.keys) {
        if (keyData.kid && keyData.n && keyData.e) {
          try {
            // Convert JWK to PEM format
            const publicKey = this.jwkToPem(keyData);
            this.publicKeys.set(keyData.kid, publicKey);
            logger.debug('Added public key', { keyId: keyData.kid });
          } catch (keyError: any) {
            logger.warn('Failed to process public key', { 
              keyId: keyData.kid, 
              error: keyError.message 
            });
          }
        }
      }

      this.lastKeyFetch = now;
      logger.info(`Loaded ${this.publicKeys.size} AMP public keys`);

    } catch (error: any) {
      logger.error('Failed to fetch AMP public keys', { error: error.message });
      
      // If we have no keys at all, this is a critical error
      if (this.publicKeys.size === 0) {
        throw new Error(`Cannot validate AMP signatures: ${error.message}`);
      }
      
      // Otherwise, use cached keys and log warning
      logger.warn('Using cached public keys due to fetch failure');
    }
  }

  /**
   * Convert JWK (JSON Web Key) to PEM format
   */
  private jwkToPem(jwk: any): string {
    // This is a simplified JWK to PEM conversion
    // In production, you might want to use a library like 'jwk-to-pem'
    const n = Buffer.from(jwk.n, 'base64url');
    const e = Buffer.from(jwk.e, 'base64url');
    
    // Create ASN.1 DER encoding for RSA public key
    const publicKeyDer = this.createRSAPublicKeyDER(n, e);
    
    // Convert to PEM format
    const publicKeyBase64 = publicKeyDer.toString('base64');
    const publicKeyPem = [
      '-----BEGIN PUBLIC KEY-----',
      ...publicKeyBase64.match(/.{1,64}/g) || [],
      '-----END PUBLIC KEY-----'
    ].join('\n');
    
    return publicKeyPem;
  }

  /**
   * Create ASN.1 DER encoding for RSA public key
   */
  private createRSAPublicKeyDER(n: Buffer, e: Buffer): Buffer {
    // This is a simplified implementation
    // For production use, consider using a proper ASN.1 library
    
    // RSA public key ASN.1 structure:
    // SEQUENCE {
    //   SEQUENCE {
    //     OBJECT IDENTIFIER rsaEncryption
    //     NULL
    //   }
    //   BIT STRING {
    //     SEQUENCE {
    //       INTEGER n
    //       INTEGER e
    //     }
    //   }
    // }
    
    const rsaOID = Buffer.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
    
    // Create INTEGER for n
    const nInteger = this.createASN1Integer(n);
    
    // Create INTEGER for e  
    const eInteger = this.createASN1Integer(e);
    
    // Create SEQUENCE for n and e
    const innerSequence = Buffer.concat([
      Buffer.from([0x30]), // SEQUENCE tag
      this.encodeLength(nInteger.length + eInteger.length),
      nInteger,
      eInteger
    ]);
    
    // Create BIT STRING
    const bitString = Buffer.concat([
      Buffer.from([0x03]), // BIT STRING tag
      this.encodeLength(innerSequence.length + 1),
      Buffer.from([0x00]), // unused bits
      innerSequence
    ]);
    
    // Create outer SEQUENCE
    const outerSequence = Buffer.concat([
      Buffer.from([0x30]), // SEQUENCE tag
      this.encodeLength(rsaOID.length + bitString.length),
      rsaOID,
      bitString
    ]);
    
    return outerSequence;
  }

  /**
   * Create ASN.1 INTEGER
   */
  private createASN1Integer(value: Buffer): Buffer {
    // Add leading zero if first bit is set (to ensure positive integer)
    const needsPadding = value[0] >= 0x80;
    const paddedValue = needsPadding ? Buffer.concat([Buffer.from([0x00]), value]) : value;
    
    return Buffer.concat([
      Buffer.from([0x02]), // INTEGER tag
      this.encodeLength(paddedValue.length),
      paddedValue
    ]);
  }

  /**
   * Encode ASN.1 length
   */
  private encodeLength(length: number): Buffer {
    if (length < 0x80) {
      return Buffer.from([length]);
    }
    
    const lengthBytes = [];
    let temp = length;
    while (temp > 0) {
      lengthBytes.unshift(temp & 0xff);
      temp = temp >> 8;
    }
    
    return Buffer.concat([
      Buffer.from([0x80 | lengthBytes.length]),
      Buffer.from(lengthBytes)
    ]);
  }

  /**
   * Get current public keys count (for monitoring)
   */
  getPublicKeysCount(): number {
    return this.publicKeys.size;
  }

  /**
   * Force refresh of public keys
   */
  async refreshPublicKeys(): Promise<void> {
    this.lastKeyFetch = 0; // Force refresh
    await this.ensurePublicKeys();
  }
}

// Export singleton instance
export const ampValidator = new AmpValidator();