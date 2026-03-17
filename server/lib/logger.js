/**
 * Structured logger using pino.
 * In development: pretty-printed output.
 * In production (Vercel): newline-delimited JSON — parseable by log aggregators.
 */

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: { service: 'betteremail-server' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev && {
        transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' }
        }
    })
});

module.exports = logger;
