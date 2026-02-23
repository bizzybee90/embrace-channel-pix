/**
 * UULE Generator for Google Search Location Targeting
 * 
 * UULE (Universal Location Encoding) codes tell Google exactly where 
 * the searcher is located, ensuring geo-targeted search results.
 * 
 * Format: w+CAIQICI[base64-encoded-location]
 */

// Pre-computed UULE codes for major UK cities
const UK_CITY_UULES: Record<string, string> = {
  'london': 'w+CAIQICIGTG9uZG9u',
  'birmingham': 'w+CAIQICIKQmlybWluZ2hhbQ',
  'manchester': 'w+CAIQICIKTWFuY2hlc3Rlcg',
  'leeds': 'w+CAIQICIFTGVlZHM',
  'liverpool': 'w+CAIQICIJTGl2ZXJwb29s',
  'sheffield': 'w+CAIQICIJU2hlZmZpZWxk',
  'bristol': 'w+CAIQICIHQnJpc3RvbA',
  'newcastle': 'w+CAIQICIJTmV3Y2FzdGxl',
  'nottingham': 'w+CAIQICIKTm90dGluZ2hhbQ',
  'southampton': 'w+CAIQICILU291dGhhbXB0b24',
  'leicester': 'w+CAIQICIJTGVpY2VzdGVy',
  'coventry': 'w+CAIQICIIQ292ZW50cnk',
  'bradford': 'w+CAIQICIIQnJhZGZvcmQ',
  'cardiff': 'w+CAIQICIHQ2FyZGlmZg',
  'belfast': 'w+CAIQICIHQmVsZmFzdA',
  'edinburgh': 'w+CAIQICIJRWRpbmJ1cmdv',
  'glasgow': 'w+CAIQICIHR2xhc2dvdw',
  'luton': 'w+CAIQICIFTHV0b24',
  'reading': 'w+CAIQICIHUmVhZGluZw',
  'wolverhampton': 'w+CAIQICINV29sdmVyaGFtcHRvbg',
  'derby': 'w+CAIQICIFRGVyYnk',
  'swansea': 'w+CAIQICIHU3dhbnNlYQ',
  'stoke': 'w+CAIQICIFU3Rva2U',
  'sunderland': 'w+CAIQICIKU3VuZGVybGFuZA',
  'oxford': 'w+CAIQICIGT3hmb3Jk',
  'cambridge': 'w+CAIQICIJQ2FtYnJpZGdl',
  'brighton': 'w+CAIQICIIQnJpZ2h0b24',
  'bournemouth': 'w+CAIQICILQm91cm5lbW91dGg',
  'portsmouth': 'w+CAIQICIKUG9ydHNtb3V0aA',
  'plymouth': 'w+CAIQICIIUGx5bW91dGg',
  'norwich': 'w+CAIQICIHTm9yd2ljaA',
  'aberdeen': 'w+CAIQICIIQWJlcmRlZW4',
  'york': 'w+CAIQICIEWW9yaw',
  'hull': 'w+CAIQICIESHVsbA',
  'middlesbrough': 'w+CAIQICINTWlkZGxlc2Jyb3VnaA',
  'milton keynes': 'w+CAIQICIMTWlsdG9uIEtleW5lcw',
  'peterborough': 'w+CAIQICIMUGV0ZXJib3JvdWdo',
  'swindon': 'w+CAIQICIHU3dpbmRvbg',
  'warrington': 'w+CAIQICIKV2FycmluZ3Rvbg',
  'slough': 'w+CAIQICIGU2xvdWdo',
  'ipswich': 'w+CAIQICIHSXBzd2ljaA',
  'exeter': 'w+CAIQICIGRXhldGVy',
  'chelmsford': 'w+CAIQICIKQ2hlbG1zZm9yZA',
  'gloucester': 'w+CAIQICIKR2xvdWNlc3Rlcg',
  'watford': 'w+CAIQICIHV2F0Zm9yZA',
  'blackpool': 'w+CAIQICIJQmxhY2twb29s',
  'bedford': 'w+CAIQICIHQmVkZm9yZA',
  'stevenage': 'w+CAIQICIJU3RldmVuYWdl',
  'hemel hempstead': 'w+CAIQICIQSGVtZWwgSGVtcHN0ZWFk',
  'harlow': 'w+CAIQICIGSGFybG93',
  'crawley': 'w+CAIQICIHQ3Jhd2xleQ',
  'basildon': 'w+CAIQICIIQmFzaWxkb24',
  'woking': 'w+CAIQICIGV29raW5n',
  'guildford': 'w+CAIQICIJR3VpbGRmb3Jk',
  'colchester': 'w+CAIQICIKQ29sY2hlc3Rlcg',
  'southend': 'w+CAIQICIIU291dGhlbmQ',
  'dunstable': 'w+CAIQICIJRHVuc3RhYmxl',
  'hitchin': 'w+CAIQICIHSGl0Y2hpbg',
  'welwyn': 'w+CAIQICIGV2Vsd3lu',
  'st albans': 'w+CAIQICIJU3QgQWxiYW5z',
};

/**
 * Generate a UULE code for a location string
 * Uses pre-computed codes for UK cities, falls back to dynamic generation
 */
export function generateUULE(location: string): string {
  if (!location) return '';
  
  // Normalize the location string
  const normalized = location.toLowerCase().trim();
  
  // Extract city name from full addresses (e.g., "123 High St, Luton, UK" -> "luton")
  const cityMatch = extractCityFromLocation(normalized);
  
  // Check for pre-computed UULE
  if (cityMatch && UK_CITY_UULES[cityMatch]) {
    return UK_CITY_UULES[cityMatch];
  }
  
  // Dynamic generation for locations not in the cache
  return dynamicUULE(location);
}

/**
 * Extract city name from a full location string
 */
function extractCityFromLocation(location: string): string | null {
  // Try each known city
  for (const city of Object.keys(UK_CITY_UULES)) {
    if (location.includes(city)) {
      return city;
    }
  }
  
  // Try to extract from comma-separated parts
  const parts = location.split(',').map(p => p.trim());
  for (const part of parts) {
    const cleaned = part.replace(/\d+/g, '').trim().toLowerCase();
    if (UK_CITY_UULES[cleaned]) {
      return cleaned;
    }
  }
  
  return null;
}

/**
 * Dynamically generate UULE code for any location
 * 
 * Google UULE format:
 * w+CAIQICI[base64(location)]
 * 
 * The prefix encodes: w (web), CAIQICI (canonical location type)
 */
function dynamicUULE(location: string): string {
  // Append ", UK" if not already present for UK-focused results
  let fullLocation = location;
  if (!location.toLowerCase().includes('uk') && 
      !location.toLowerCase().includes('united kingdom')) {
    fullLocation = `${location}, UK`;
  }
  
  // Base64 encode the location (UTF-8 safe)
  const encoded = base64EncodeUtf8(fullLocation);
  
  // Prepend the UULE header
  return `w+CAIQICI${encoded}`;
}

/**
 * UTF-8 safe base64 encoding for Deno
 */
function base64EncodeUtf8(input: string): string {
  // Use TextEncoder to get UTF-8 bytes, then btoa on the binary string
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Get UK county/region for a city (helpful for broader searches)
 */
export const UK_CITY_COUNTIES: Record<string, string> = {
  'luton': 'Bedfordshire',
  'bedford': 'Bedfordshire',
  'dunstable': 'Bedfordshire',
  'london': 'Greater London',
  'birmingham': 'West Midlands',
  'manchester': 'Greater Manchester',
  'leeds': 'West Yorkshire',
  'liverpool': 'Merseyside',
  'sheffield': 'South Yorkshire',
  'bristol': 'Bristol',
  'newcastle': 'Tyne and Wear',
  'nottingham': 'Nottinghamshire',
  'leicester': 'Leicestershire',
  'coventry': 'West Midlands',
  'cardiff': 'South Wales',
  'edinburgh': 'Scotland',
  'glasgow': 'Scotland',
  'reading': 'Berkshire',
  'oxford': 'Oxfordshire',
  'cambridge': 'Cambridgeshire',
  'brighton': 'East Sussex',
  'bournemouth': 'Dorset',
  'portsmouth': 'Hampshire',
  'southampton': 'Hampshire',
  'exeter': 'Devon',
  'plymouth': 'Devon',
  'norwich': 'Norfolk',
  'ipswich': 'Suffolk',
  'chelmsford': 'Essex',
  'colchester': 'Essex',
  'basildon': 'Essex',
  'southend': 'Essex',
  'st albans': 'Hertfordshire',
  'stevenage': 'Hertfordshire',
  'hemel hempstead': 'Hertfordshire',
  'watford': 'Hertfordshire',
  'welwyn': 'Hertfordshire',
  'hitchin': 'Hertfordshire',
  'harlow': 'Essex',
  'crawley': 'West Sussex',
  'guildford': 'Surrey',
  'woking': 'Surrey',
  'slough': 'Berkshire',
  'milton keynes': 'Buckinghamshire',
  'peterborough': 'Cambridgeshire',
  'gloucester': 'Gloucestershire',
  'swindon': 'Wiltshire',
  'york': 'North Yorkshire',
  'hull': 'East Yorkshire',
  'middlesbrough': 'North Yorkshire',
  'blackpool': 'Lancashire',
  'warrington': 'Cheshire',
  'stoke': 'Staffordshire',
  'wolverhampton': 'West Midlands',
  'derby': 'Derbyshire',
  'aberdeen': 'Scotland',
  'swansea': 'Wales',
  'belfast': 'Northern Ireland',
  'bradford': 'West Yorkshire',
  'sunderland': 'Tyne and Wear',
};

/**
 * Get county for a city (returns undefined if not found)
 */
export function getCountyForCity(city: string): string | undefined {
  return UK_CITY_COUNTIES[city.toLowerCase().trim()];
}
