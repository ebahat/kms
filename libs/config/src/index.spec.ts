import { loadQueueEnv } from './index';

describe('loadQueueEnv', () => {
  it('defaults REDIS_QUEUE_HOST to localhost when unset', () => {
    expect(loadQueueEnv({})).toEqual({ REDIS_QUEUE_HOST: 'localhost' });
  });

  it('reads REDIS_QUEUE_HOST from the given env', () => {
    expect(loadQueueEnv({ REDIS_QUEUE_HOST: 'redis-queue' })).toEqual({ REDIS_QUEUE_HOST: 'redis-queue' });
  });
});
