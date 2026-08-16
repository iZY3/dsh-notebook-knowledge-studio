/**
 * Notebook Studio 网页抓取边界。
 *
 * Harness 的 web-fetch-http provider 负责 HTTP 传输、重定向、超时、字节/字符
 * 上限与文本解码；本层补上插件所需的公网 URL 策略与稳定错误映射。
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import net from 'node:net'

const MAX_URL_LENGTH = 2048

export class WebSourceError extends Error {
  constructor(message, code, statusCode, options = {}) {
    super(message, options)
    this.name = 'WebSourceError'
    this.code = code
    this.statusCode = statusCode
  }
}

function fail(message, code = 'WEB_BLOCKED_URL', statusCode = 400, cause) {
  throw new WebSourceError(message, code, statusCode, cause ? { cause } : undefined)
}

function ipv4ToInt(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0
}

function ipv4InCidr(value, base, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (value & mask) === (base & mask)
}

const BLOCKED_IPV4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].map(([base, prefix]) => [ipv4ToInt(base), prefix])

function isPublicIpv4(address) {
  const value = ipv4ToInt(address)
  if (value === null) return false
  return !BLOCKED_IPV4.some(([base, prefix]) => ipv4InCidr(value, base, prefix))
}

function parseIpv6(address) {
  let input = String(address).toLowerCase()
  if (input.startsWith('[') && input.endsWith(']')) input = input.slice(1, -1)
  const zone = input.indexOf('%')
  if (zone >= 0) input = input.slice(0, zone)

  // Embedded IPv4 occupies the final two hextets.
  const ipv4Match = input.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)
  if (ipv4Match) {
    const value = ipv4ToInt(ipv4Match[1])
    if (value === null) return null
    input = input.slice(0, -ipv4Match[1].length) + `${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`
  }

  if ((input.match(/::/g) ?? []).length > 1) return null
  const [leftRaw, rightRaw = ''] = input.split('::')
  const left = leftRaw ? leftRaw.split(':') : []
  const right = rightRaw ? rightRaw.split(':') : []
  const fill = input.includes('::') ? 8 - left.length - right.length : 0
  if (fill < 0 || (!input.includes('::') && left.length !== 8)) return null
  const words = [...left, ...Array(fill).fill('0'), ...right]
  if (words.length !== 8 || words.some(w => !/^[0-9a-f]{1,4}$/.test(w))) return null
  const bytes = new Uint8Array(16)
  words.forEach((word, i) => {
    const value = parseInt(word, 16)
    bytes[i * 2] = value >>> 8
    bytes[i * 2 + 1] = value & 0xff
  })
  return bytes
}

function hasPrefix(bytes, prefix, bits) {
  const whole = Math.floor(bits / 8)
  const rest = bits % 8
  for (let i = 0; i < whole; i++) if (bytes[i] !== prefix[i]) return false
  if (!rest) return true
  const mask = (0xff << (8 - rest)) & 0xff
  return (bytes[whole] & mask) === (prefix[whole] & mask)
}

function ipv6Prefix(address) {
  const bytes = parseIpv6(address)
  if (!bytes) throw new Error(`invalid IPv6 prefix: ${address}`)
  return bytes
}

const IPV6_PREFIXES = {
  mapped: ipv6Prefix('::ffff:0:0'),
  global: ipv6Prefix('2000::'),
  nat64: ipv6Prefix('64:ff9b::'),
  nat64Local: ipv6Prefix('64:ff9b:1::'),
  discard: ipv6Prefix('100::'),
  teredo: ipv6Prefix('2001::'),
  documentation: ipv6Prefix('2001:db8::'),
  sixToFour: ipv6Prefix('2002::'),
  uniqueLocal: ipv6Prefix('fc00::'),
  linkLocal: ipv6Prefix('fe80::'),
  multicast: ipv6Prefix('ff00::'),
}

function isPublicIpv6(address) {
  const bytes = parseIpv6(address)
  if (!bytes) return false

  if (hasPrefix(bytes, IPV6_PREFIXES.mapped, 96)) {
    return isPublicIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`)
  }
  if (hasPrefix(bytes, ipv6Prefix('::'), 96)) return false
  if (hasPrefix(bytes, IPV6_PREFIXES.nat64, 96)) return false
  if (hasPrefix(bytes, IPV6_PREFIXES.nat64Local, 48)) return false
  if (hasPrefix(bytes, IPV6_PREFIXES.discard, 64)) return false
  if (hasPrefix(bytes, IPV6_PREFIXES.teredo, 32)) return false
  if (hasPrefix(bytes, IPV6_PREFIXES.documentation, 32)) return false
  if (hasPrefix(bytes, IPV6_PREFIXES.sixToFour, 16)) return false
  if (hasPrefix(bytes, IPV6_PREFIXES.uniqueLocal, 7)) return false
  if (hasPrefix(bytes, IPV6_PREFIXES.linkLocal, 10)) return false
  if (hasPrefix(bytes, IPV6_PREFIXES.multicast, 8)) return false
  return hasPrefix(bytes, IPV6_PREFIXES.global, 3)
}

export function isPublicIp(address) {
  const version = net.isIP(String(address))
  if (version === 4) return isPublicIpv4(String(address))
  if (version === 6) return isPublicIpv6(String(address))
  return false
}

/** 解析并验证 URL；域名的全部 A/AAAA 结果都必须是公网地址。 */
export async function validatePublicUrl(input, { lookup = dnsLookup } = {}) {
  const raw = String(input ?? '').trim()
  if (!raw || raw.length > MAX_URL_LENGTH) fail('网址为空或超过 2048 个字符', 'WEB_INVALID_URL', 400)

  let url
  try { url = new URL(raw) } catch (error) {
    fail('网址格式无效', 'WEB_INVALID_URL', 400, error)
  }
  if (!['http:', 'https:'].includes(url.protocol)) fail('仅允许公网 HTTP(S) 网址')
  if (url.username || url.password) fail('网址不得包含用户名或密码')

  let hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1)
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    fail('禁止访问本机或局域网地址')
  }

  const literalVersion = net.isIP(hostname)
  if (literalVersion) {
    if (!isPublicIp(hostname)) fail('禁止访问私网、保留地址或云元数据端点')
  } else {
    if (!hostname.includes('.')) fail('仅允许可公开解析的完整域名')
    let records
    try {
      records = await lookup(hostname, { all: true, verbatim: true })
    } catch (error) {
      fail(`域名解析失败: ${hostname}`, 'WEB_DNS_FAILED', 422, error)
    }
    if (!Array.isArray(records) || !records.length) fail(`域名没有可用地址: ${hostname}`, 'WEB_DNS_FAILED', 422)
    const blocked = records.find(record => !isPublicIp(record.address))
    if (blocked) fail(`域名解析到非公网地址，已阻止: ${blocked.address}`)
  }

  return url.toString()
}

const PROVIDER_UNAVAILABLE = new Set([
  'WEB_PROVIDER_UNAVAILABLE',
  'WEB_PROVIDER_CONFIGURED_MISSING',
  'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
  'WEB_PROVIDER_AMBIGUOUS',
])

/** 将 Harness WebError 映射为稳定、面向用户的错误。 */
export function mapFetchError(error) {
  if (error instanceof WebSourceError) return error
  const code = String(error?.code ?? '')
  if (PROVIDER_UNAVAILABLE.has(code) || /no usable web provider/i.test(String(error?.message ?? ''))) {
    return new WebSourceError('网页抓取服务未加载，请安装 fetch provider 并重启 DeepSeek Harness', 'WEB_FETCH_UNAVAILABLE', 503, { cause: error })
  }
  if (code === 'WEB_FETCH_TIMEOUT' || code === 'TOOL_TIMEOUT') {
    return new WebSourceError('网页抓取超时，请稍后重试', 'WEB_FETCH_TIMEOUT', 504, { cause: error })
  }
  if (code === 'WEB_FETCH_TOO_LARGE') {
    return new WebSourceError('网页正文超过允许大小', code, 422, { cause: error })
  }
  if (code === 'WEB_UNSUPPORTED_CONTENT_TYPE') {
    return new WebSourceError('网页不是可导入的 HTML 或文本内容', code, 422, { cause: error })
  }
  if (code === 'WEB_INVALID_URL' || code === 'WEB_BLOCKED_URL') {
    return new WebSourceError(String(error.message ?? '网址无效或被安全策略阻止'), code, 400, { cause: error })
  }
  if (code === 'WEB_ABORTED') {
    return new WebSourceError('网页抓取已取消', code, 499, { cause: error })
  }
  return new WebSourceError(`网页抓取失败: ${String(error?.message ?? error)}`, code || 'WEB_FETCH_FAILED', 502, { cause: error })
}

export async function fetchPublicUrl(webService, input, { lookup } = {}) {
  if (!webService) {
    throw new WebSourceError('DeepSeek Harness web 服务未挂载', 'WEB_FETCH_UNAVAILABLE', 503)
  }
  const url = await validatePublicUrl(input, { ...(lookup ? { lookup } : {}) })
  try {
    return await webService.fetch({ url })
  } catch (error) {
    throw mapFetchError(error)
  }
}
