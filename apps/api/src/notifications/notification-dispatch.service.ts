import { Injectable, Logger } from '@nestjs/common';
import { EventDocument, TaskDocument } from '@kms/data';

/**
 * Placeholder (Task 4) — Task 6 replaces this with real email-sending logic.
 * Signatures are stable so call sites (EventsController, TasksController) don't need to change.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  async notifyEventCreated(event: EventDocument): Promise<void> {
    this.logger.debug(`notifyEventCreated placeholder — event ${event._id.toString()} not yet dispatched`);
  }

  async notifyTaskAssigned(task: TaskDocument): Promise<void> {
    this.logger.debug(`notifyTaskAssigned placeholder — task ${task._id.toString()} not yet dispatched`);
  }
}
