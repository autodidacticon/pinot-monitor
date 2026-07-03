import { describe, expect, it } from 'vitest';
import { brokerUrl, controllerUrl, serverUrl } from './config.js';

describe('config URL builders', () => {
  it('builds the controller URL from host and port defaults', () => {
    expect(controllerUrl('/health')).toBe(
      'http://pinot-controller.pinot.svc.cluster.local:9000/health'
    );
  });

  it('builds the broker URL', () => {
    expect(brokerUrl('/query/sql')).toBe(
      'http://pinot-broker.pinot.svc.cluster.local:8099/query/sql'
    );
  });

  it('builds the server URL', () => {
    expect(serverUrl('/')).toBe('http://pinot-server.pinot.svc.cluster.local:80/');
  });
});
