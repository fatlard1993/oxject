import { beforeEach, mock, spyOn } from 'bun:test';

global.mock = mock;
global.spyOn = spyOn;

beforeEach(() => {
	mock.restore();
});
