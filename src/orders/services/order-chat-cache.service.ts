import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../redis/redis.service';
import { ChatMessage } from '../entities/chat-message.entity';

const CACHE_TTL_SEC = 48 * 3600; // 48 hours
const MAX_RECENT_MESSAGES = 50;

@Injectable()
export class OrderChatCacheService {
  private readonly logger = new Logger(OrderChatCacheService.name);

  constructor(private readonly redis: RedisService) { }

  private getCacheKey(orderId: string): string {
    return `chat:order:${orderId}:recent`;
  }

  /**
   * Retrieves the most recent messages from Redis cache (chronological order).
   * Returns null on cache miss or Redis error.
   */
  async getRecentMessages(orderId: string): Promise<ChatMessage[] | null> {
    try {
      const key = this.getCacheKey(orderId);
      const raw = await this.redis.client.lrange(key, 0, -1);
      if (!raw || raw.length === 0) return null;

      return raw.map((item) => JSON.parse(item) as ChatMessage);
    } catch (err: unknown) {
      this.logger.warn(`Failed to read chat cache for order ${orderId}: ${err}`);
      return null;
    }
  }

  /**
   * Appends a message to the recent list in Redis and trims to the last 50 items.
   */
  async pushMessage(orderId: string, message: ChatMessage): Promise<void> {
    try {
      const key = this.getCacheKey(orderId);
      const serialized = JSON.stringify(message);

      await this.redis.client
        .pipeline()
        .rpush(key, serialized)
        .ltrim(key, -MAX_RECENT_MESSAGES, -1)
        .expire(key, CACHE_TTL_SEC)
        .exec();
    } catch (err: unknown) {
      this.logger.warn(`Failed to push chat message to cache for order ${orderId}: ${err}`);
    }
  }

  /**
   * Seeds the cache with messages from PostgreSQL (e.g. after a cache miss).
   */
  async seedRecentMessages(
    orderId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    if (!messages || messages.length === 0) return;
    try {
      const key = this.getCacheKey(orderId);
      const items = messages
        .slice(-MAX_RECENT_MESSAGES)
        .map((m) => JSON.stringify(m));

      await this.redis.client
        .pipeline()
        .del(key)
        .rpush(key, ...items)
        .expire(key, CACHE_TTL_SEC)
        .exec();
    } catch (err: unknown) {
      this.logger.warn(`Failed to seed chat cache for order ${orderId}: ${err}`);
    }
  }

  /**
   * Invalidates the recent messages cache for an order.
   */
  async invalidate(orderId: string): Promise<void> {
    try {
      await this.redis.client.del(this.getCacheKey(orderId));
    } catch (err: unknown) {
      this.logger.warn(`Failed to invalidate chat cache for order ${orderId}: ${err}`);
    }
  }
}