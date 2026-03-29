#!/usr/bin/env node
/**
 * Decode JWT to find OAuth configuration
 */

const token = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjE5MzQ0ZTY1LWJiYzktNDRkMS1hOWQwLWY5NTdiMDc5YmQwZSIsInR5cCI6IkpXVCJ9.eyJhdWQiOlsiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MSJdLCJjbGllbnRfaWQiOiJhcHBfRU1vYW1FRVo3M2YwQ2tYYVhwN2hyYW5uIiwiZXhwIjoxNzc0NjE0MzcyLCJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYThhNDU4MGEtMDRjNy00NGI1LWE0OGEtZmZkNDY3OTdjOTE5IiwiY2hhdGdwdF9hY2NvdW50X3VzZXJfaWQiOiJ1c2VyLUttUEtvaE9MRUJNVXBwWlZmN3VtVFZWTF9fYThhNDU4MGEtMDRjNy00NGI1LWE0OGEtZmZkNDY3OTdjOTE5IiwiY2hhdGdwdF9jb21wdXRlX3Jlc2lkZW5jeSI6Im5vX2NvbnN0cmFpbnQiLCJjaGF0Z3B0X3BsYW5fdHlwZSI6InBsdXMiLCJjaGF0Z3B0X3VzZXJfaWQiOiJ1c2VyLUttUEtvaE9MRUJNVXBwWlZmN3VtVFZXTCIsInVzZXJfaWQiOiJ1c2VyLUttUEtvaE9MRUJNVXBwWlZmN3VtVFZXTCJ9LCJodHRwczovL2FwaS5vcGVuYWkuY29tL3Byb2ZpbGUiOnsiZW1haWwiOiJjaHJpenRpYW5uLnZpbGxhYmxhbmNhQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlfSwiaWF0IjoxNzczNzUwMzcxLCJpc3MiOiJodHRwczovL2F1dGgub3BlbmFpLmNvbSIsImp0aSI6ImFhZTlmYTZjLWZlMTItNDBhMS05MzVmLTRkZGY1ZDM4Zjc4OCIsIm5iZiI6MTc3Mzc1MDM3MSwicHdkX2F1dGhfdGltZSI6MTc3MDg1NTc4MzMxMiwic2NwIjpbIm9wZW5pZCIsInByb2ZpbGUiLCJlbWFpbCIsIm9mZmxpbmVfYWNjZXNzIl0sInNlc3Npb25faWQiOiJhdXRoc2Vzc19qbXlDUDlrWXdsQ2RUMUdZUVBOOVdIQm4iLCJzbCI6dHJ1ZSwic3ViIjoiZ29vZ2xlLW9hdXRoMnwxMDE1MDY3NTEwNzE5NTU1MTQ2MTcifQ.p7jq5qlgPwWcc7eRYU8mguvzmWXrBWMqv5EFvJHqjQEpIkFy-03JxRRmq0VZtk1BD9d0m-Purt-j9vMcjmgmmTHCsojxxiL7e0bBzyk8dg-3T-hxTadGEscLrkI54hqWK2riIoYUXemtds9Fgx2rRrwLkABK2bS0mWUdkOS2_drTDpzHZootqhzyT_EgMMM2ER-hw1KxyhTYbB8f5KZ6sUa6LopC4x6mbxS0qAaS43CkVOVFSHm7wmIR-kCkxCH45KrixqAIfauSLlH1RitztoNac1_iS_ggTMQXX3b50xFmiSVfscllmA61-JdCoBmRt131HDbT30R24M25eQonsoFTqw-GJqQn58YZxFbA1cqfJ3rL811k515CIshdgUf69mkSR6UhC-TzHuZ85Z9g22X9xG35fDiMPyBL48vKJow5dGLAkLnkvqMuvYSa6Mu9ZOJ5ffGzbQbPv7UdyGjTdD_komgm-cUQHWDG96nFtZ0D7w2lLxxiMUxIqHWIBtoDzQIp9fQOhIVMbmbMA0awUTAIKuOvzVni-19O3LEuyjCWpwFXxgveYEoi0shLXHJLwXU5-_vO4uhamljNiZczlKrMPRS1VJouUeILlvKwjO79W1m2Sg0PJwHuJ0sEdrqXoE8Vu_yYbYqS7q8hD_OuHu-8Vs2DaiFaVVnqh-1DuCM";

// Decode JWT (split by . and decode base64url)
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString();
}

const parts = token.split('.');
const header = JSON.parse(base64urlDecode(parts[0]));
const payload = JSON.parse(base64urlDecode(parts[1]));

console.log('=== JWT Header ===');
console.log(JSON.stringify(header, null, 2));

console.log('\n=== JWT Payload ===');
console.log(JSON.stringify(payload, null, 2));

console.log('\n=== Key OAuth Information ===');
console.log('Issuer (iss):', payload.iss);
console.log('Audience (aud):', payload.aud);
console.log('Client ID:', payload.client_id);
console.log('Scopes:', payload.scp);
console.log('Expires at (exp):', new Date(payload.exp * 1000).toISOString());
console.log('Issued at (iat):', new Date(payload.iat * 1000).toISOString());
