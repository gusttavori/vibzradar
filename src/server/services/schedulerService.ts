/**
 * Radar Vibz - Scheduler Service (node-cron)
 * Agendamento automático e periódico de varreduras de perfis do Instagram
 */

import cron, { ScheduledTask } from 'node-cron';
import { db } from '../database';
import { monitoringEngine } from './monitoringEngine';

export interface SchedulerStatus {
  isRunning: boolean;
  autoScheduled: boolean;
  intervalMinutes: number;
  cronExpression: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export function getCronExpressionForMinutes(intervalMinutes: number): string {
  if (!intervalMinutes || intervalMinutes < 1) return '*/30 * * * *';
  if (intervalMinutes < 60) return `*/${intervalMinutes} * * * *`;
  const hours = Math.floor(intervalMinutes / 60);
  if (hours <= 1) return '0 * * * *';
  if (hours < 24) return `0 */${hours} * * *`;
  return '0 0 * * *';
}

export class SchedulerService {
  private cronTask: ScheduledTask | null = null;
  private cleanupTask: ScheduledTask | null = null;
  private currentCronExpression: string | null = null;
  private isEnabled: boolean = false;
  private currentIntervalMinutes: number = 30;

  public async init(): Promise<void> {
    await this.reload(true);
  }

  public async reload(force: boolean = false): Promise<void> {
    const settings = await db.getSettings();
    const autoScheduled = !!settings.monitoring?.autoScheduled;
    const intervalMinutes = Number(settings.monitoring?.intervalMinutes) || 30;
    
    // Força o cron para rodar exatamente às 09:00, 12:00, 16:00 e 19:00
    const cronExpression = '0 9,12,16,19 * * *'; 

    if (
      !force &&
      this.cronTask &&
      this.isEnabled === autoScheduled &&
      this.currentIntervalMinutes === intervalMinutes &&
      this.currentCronExpression === cronExpression
    ) {
      return;
    }

    this.stop();

    this.isEnabled = autoScheduled;
    this.currentIntervalMinutes = intervalMinutes;
    this.currentCronExpression = cronExpression;

    if (!autoScheduled) {
      await db.logSystem(
        'INFO',
        'MONITORING',
        'Agendador de monitoramento desativado (autoScheduled = false nas configurações).'
      );
      console.log('[Radar Vibz Scheduler] Monitoramento automático pausado nas configurações.');
      return;
    }

    try {
      // 1. TAREFA PRINCIPAL: Varredura dos perfis
      this.cronTask = cron.schedule(
        this.currentCronExpression, 
        async () => {
          console.log(`[Radar Vibz Scheduler] Disparando ciclo agendado em ${new Date().toISOString()}...`);
          try {
            await monitoringEngine.runCycleNow(true);
          } catch (err) {
            console.error('[Radar Vibz Scheduler] Falha na execução do ciclo agendado:', err);
          }
        },
        { timezone: 'America/Bahia' }
      );

      // 2. TAREFA SECUNDÁRIA: Limpeza do CRM (Roda todos os dias às 03:00 da madrugada)
      this.cleanupTask = cron.schedule(
        '0 3 * * *',
        async () => {
          try {
            const removed = await db.cleanupExpiredConvertedOpportunities(7);
            if (removed > 0) {
              await db.logSystem(
                'INFO',
                'MONITORING',
                `Limpeza automática: ${removed} oportunidades convertidas (+7 dias) arquivadas na blacklist e removidas.`
              );
            }
          } catch (err) {
            console.error('[Radar Vibz Scheduler] Erro na limpeza de convertidas:', err);
          }
        },
        { timezone: 'America/Bahia' }
      );

      await db.logSystem(
        'INFO',
        'MONITORING',
        `Agendador de monitoramento ativado: intervalo ${intervalMinutes}m (cron: "${this.currentCronExpression}").`
      );
      console.log(`[Radar Vibz Scheduler] Agendador ativo com cron "${this.currentCronExpression}" no fuso America/Bahia.`);
    } catch (err) {
      await db.logSystem(
        'ERROR',
        'MONITORING',
        `Falha ao iniciar tarefa cron: ${err instanceof Error ? err.message : String(err)}`
      );
      console.error('[Radar Vibz Scheduler] Falha ao registrar tarefa cron:', err);
    }
  }

  public stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    if (this.cleanupTask) {
      this.cleanupTask.stop();
      this.cleanupTask = null;
    }
  }

  public async getStatus(): Promise<SchedulerStatus> {
    const settings = await db.getSettings();
    return {
      isRunning: !!this.cronTask && this.isEnabled,
      autoScheduled: !!settings.monitoring?.autoScheduled,
      intervalMinutes: settings.monitoring?.intervalMinutes || 30,
      cronExpression: this.currentCronExpression,
      lastRunAt: settings.monitoring?.lastRunAt || null,
      nextRunAt: settings.monitoring?.nextRunAt || null,
    };
  }
}

export const schedulerService = new SchedulerService();