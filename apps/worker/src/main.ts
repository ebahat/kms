import 'reflect-metadata';
import { resolveWorkerPool, POOL_QUEUES } from './pools';

/**
 * Stage processors (scan, parse, ocr-*, chunk, embed, index) register here
 * per pool starting Phase 3. This bootstrap only proves pool selection and
 * queue binding work end-to-end.
 */
function bootstrap() {
  const pool = resolveWorkerPool();
  const queues = POOL_QUEUES[pool];
  console.log(`worker pool "${pool}" starting, consuming queues: ${queues.join(', ')}`);
}

bootstrap();
