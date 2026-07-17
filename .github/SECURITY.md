# Security Policy

## Supported Versions

We actively support the following versions with security updates:

| Version | Supported |
| ------- | --------- |
| 0.4.x   | Yes       |
| < 0.4   | No        |

## Reporting a Vulnerability

We take the security of Synthetic Values seriously. If you discover a
security vulnerability, please follow these guidelines.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of these methods:

1. **GitHub Security Advisory**: Use the [GitHub Security Advisory](https://github.com/NearlCrews/signalk-synthetic-values/security/advisories/new) feature (preferred).
2. **GitHub Issues**: For non-sensitive security concerns, open an [issue](https://github.com/NearlCrews/signalk-synthetic-values/issues).

### What to Include

Please include the following information in your report:

- **Description** of the vulnerability
- **Steps to reproduce** the issue
- **Potential impact** of the vulnerability
- **Suggested fix** (if you have one)
- **Your contact information** for follow-up

### Response Timeline

- **Initial Response**: within 48 hours of report
- **Status Update**: within 7 days with a preliminary assessment
- **Fix Timeline**: depends on severity, typically within 30 days

## Security Best Practices

When using this plugin:

1. **Keep Updated**: always use the latest version.
2. **Network Security**: ensure your Signal K server is properly secured and
   limit access to trusted networks.
3. **Access Control**: limit access to your Signal K admin interface.
4. **Monitor Logs**: watch for unusual activity in the Signal K logs.

## Dependency Security

This project uses:

- `npm audit` for vulnerability scanning (`npm run security-audit`)
- Automated dependency updates via Dependabot for security patches
- CodeQL static analysis on every push to `main`

Run a security audit:

```bash
npm run security-audit
npm run audit:runtime
```

## Data Handling

This plugin reads sensor values already present on the Signal K bus and
publishes computed synthetic values back to the bus. It does not transmit
data to any external service, make outbound network connections, or handle
credentials of any kind.

## Signal K Security

This plugin operates within the Signal K server environment. Please also
refer to the [Signal K documentation](https://signalk.org/documentation/) and
[Signal K server security best practices](https://github.com/SignalK/signalk-server/blob/master/SECURITY.md).

## Marine Safety Notice

This plugin derives synthetic values from redundant onboard sensors. While we
strive for correctness and reliability:

- **Not for Safety-Critical Use**: this software should not be relied upon
  as the sole means of instrument validation or navigation.
- **Professional Equipment**: always maintain certified instruments and
  cross-check against primary sources.
- **Test Thoroughly**: test in non-critical conditions before relying on
  this plugin.

## Disclosure Policy

- We will coordinate disclosure timing with the reporter.
- Public disclosure will occur after a fix is available.
- Credit will be given to reporters (if desired).
- A security advisory will be published on GitHub.
