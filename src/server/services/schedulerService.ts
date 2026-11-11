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

/**
 * Converte um intervalo em minutos para uma expressão cron padrão com espaçamento correto
 */
export function getCronExpressionForMinutes(intervalMinutes: number): string {
  if (!intervalMinutes || intervalMinutes < 1) {
    return '*/30 * * * *'; // Padrão de segurança: 30 minutos
  }
  if (intervalMinutes < 60) {
    return `*/${intervalMinutes} * * * *`;
  }
  const hours = Math.floor(intervalMinutes / 60);
  if (hours <= 1) {
    return '0 * * * *'; // A cada 1 hora no minuto zero
  }
  if (hours < 24) {
    return `0 */${hours} * * *`; // A cada N horas
  }
  return '0 0 * * *'; // Diário à meia-noite
}

export class SchedulerService {
  private cronTask: ScheduledTask | null = null;
  private currentCronExpression: string | null = null;
  private isEnabled: boolean = false;
  private currentIntervalMinutes: number = 30;

  /**
   * Inicializa o agendador com base nas configurações persistidas no PostgreSQL via Prisma
   */
  public async init(): Promise<void> {
    await this.reload(true);
  }

  /**
   * Recria ou atualiza o agendador se as configurações sofrerem mutação
   */
  public async reload(force: boolean = false): Promise<void> {
    const settings = await db.getSettings();
    const autoScheduled = !!settings.monitoring?.autoScheduled;
    const intervalMinutes = Number(settings.monitoring?.intervalMinutes) || 30;
    const cronExpression = getCronExpressionForMinutes(intervalMinutes);

    // Se nada mudou e já está ativo, evita recriação desnecessária de tarefas
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

    if (!cron.validate(cronExpression)) {
      console.warn(`[Radar Vibz Scheduler] Expressão cron "${cronExpression}" inválida. Usando padrão */30.`);
      this.currentCronExpression = '*/30 * * * *';
    }

    try {
      this.cronTask = cron.schedule(this.currentCronExpression, async () => {
        console.log(`[Radar Vibz Scheduler] Disparando ciclo agendado em ${new Date().toISOString()}...`);
        try {
          // Executa APENAS o ciclo de monitoramento base do sistema unificado
          await monitoringEngine.runCycleNow(true);
        } catch (err) {
          console.error('[Radar Vibz Scheduler] Falha na execução do ciclo agendado:', err);
        }
      });

      await db.logSystem(
        'INFO',
        'MONITORING',
        `Agendador de monitoramento ativado: intervalo ${intervalMinutes}m (cron: "${this.currentCronExpression}").`
      );
      console.log(`[Radar Vibz Scheduler] Agendador ativo com cron "${this.currentCronExpression}" (${intervalMinutes} min).`);
    } catch (err) {
      await db.logSystem(
        'ERROR',
        'MONITORING',
        `Falha ao iniciar tarefa cron: ${err instanceof Error ? err.message : String(err)}`
      );
      console.error('[Radar Vibz Scheduler] Falha ao registrar tarefa cron:', err);
    }
  }

  /**
   * Interrompe a tarefa de agendamento em execução
   */
  public stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
  }

  /**
   * Obtém o status operacional do agendador
   */
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