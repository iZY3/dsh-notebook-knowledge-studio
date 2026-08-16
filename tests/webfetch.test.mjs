import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublicIp, mapFetchError, validatePublicUrl, WebSourceError } from '../lib/webfetch.mjs'

const publicLookup = async () => [
  { address: '93.184.216.34', family: 4 },
  { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
]

test('公网 IP 判定覆盖 IPv4/IPv6 与映射地址', () => {
  assert.equal(isPublicIp('8.8.8.8'), true)
  assert.equal(isPublicIp('127.0.0.1'), false)
  assert.equal(isPublicIp('10.0.0.1'), false)
  assert.equal(isPublicIp('169.254.169.254'), false)
  assert.equal(isPublicIp('2606:4700:4700::1111'), true)
  assert.equal(isPublicIp('::1'), false)
  assert.equal(isPublicIp('fc00::1'), false)
  assert.equal(isPublicIp('fe80::1'), false)
  assert.equal(isPublicIp('::ffff:127.0.0.1'), false)
  assert.equal(isPublicIp('::ffff:8.8.8.8'), true)
})

test('validatePublicUrl 允许公网 HTTP(S) 且规范化 URL', async () => {
  const value = await validatePublicUrl('https://Example.COM/article?q=1', { lookup: publicLookup })
  assert.equal(value, 'https://example.com/article?q=1')
})

test('validatePublicUrl 拒绝协议、凭据、本机、私网与单标签域名', async () => {
  const blocked = [
    'file:///etc/passwd',
    'https://user:pass@example.com/',
    'http://localhost:3000/',
    'http://service.local/',
    'http://intranet/',
    'http://127.0.0.1/',
    'http://10.0.0.8/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fc00::1]/',
  ]
  for (const url of blocked) {
    await assert.rejects(
      () => validatePublicUrl(url, { lookup: publicLookup }),
      error => error instanceof WebSourceError && error.code === 'WEB_BLOCKED_URL',
      url,
    )
  }
})

test('validatePublicUrl 拒绝解析到私网或公网/私网混合地址的域名', async () => {
  const privateLookup = async () => [{ address: '192.168.1.20', family: 4 }]
  const mixedLookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.5', family: 4 },
  ]
  await assert.rejects(() => validatePublicUrl('https://private.example/', { lookup: privateLookup }), /非公网地址/)
  await assert.rejects(() => validatePublicUrl('https://mixed.example/', { lookup: mixedLookup }), /非公网地址/)
})

test('validatePublicUrl 将 DNS 失败映射为稳定错误', async () => {
  await assert.rejects(
    () => validatePublicUrl('https://missing.example/', { lookup: async () => { throw new Error('ENOTFOUND') } }),
    error => error.code === 'WEB_DNS_FAILED' && error.statusCode === 422,
  )
})

test('mapFetchError 映射 provider/timeout/size 错误', () => {
  const unavailable = mapFetchError(Object.assign(new Error('none'), { code: 'WEB_PROVIDER_UNAVAILABLE' }))
  assert.equal(unavailable.code, 'WEB_FETCH_UNAVAILABLE')
  assert.equal(unavailable.statusCode, 503)

  const timeout = mapFetchError(Object.assign(new Error('slow'), { code: 'WEB_FETCH_TIMEOUT' }))
  assert.equal(timeout.statusCode, 504)

  const tooLarge = mapFetchError(Object.assign(new Error('large'), { code: 'WEB_FETCH_TOO_LARGE' }))
  assert.equal(tooLarge.statusCode, 422)
})
