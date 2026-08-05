import { Injectable, Logger } from '@nestjs/common';
import { EventDocument } from '@kms/data';

/**
 * Placeholder (Task 4) — Task 6 replaces this with real email-sending logic.
 * Signature is stable so EventsController's call site doesn't need to change.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  async notifyEventCreated(event: EventDocument): Promise<void> {
    this.logger.debug(`notifyEventCreated placeholder — event ${event._id.toString()} not yet dispatched`);
  }
}
