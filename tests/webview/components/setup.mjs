import { chai } from 'node:test';
import { jsdom } from 'jsdom';

// Set up jsdom environment
const dom = new jsdom('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

// Mock clipboard API
global.navigator.clipboard = {
  writeText: async (text) => Promise.resolve(),
  readText: async () => Promise.resolve(''),
};

// Mock requestAnimationFrame
global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
