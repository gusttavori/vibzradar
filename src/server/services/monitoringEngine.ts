/**
 * Radar Vibz - Monitoring Engine
 * Motor de orquestração periódica, varredura de perfis e descoberta automática de novos alvos
 */

import { db } from '../database';
import { MetaInstagramProvider, DemoSimulationProvider, InstagramProvider } from './instagramProvider';
import { aiAnalysisService } from './publicationAnalysisService';
import { notificationService } from './notificationService';
import { discoveryService } from './discoveryService';

export class MonitoringEngine {
  private metaProvider: MetaInstagramProvider;
  private demoProvider: DemoSimulationProvider;
  private isMonitoring: boolean = false;

  constructor() {
    this.metaProvider = new MetaInstagramProvider();
    this.demoProvider = new DemoSimulationProvider();
  }

  private async getActiveProvider(): Promise<InstagramProvider> {
    const settings = await db.getSettings();
    if (settings.instagram.providerMode === 'meta_graph_api') {
      return this.metaProvider;
    }
    return this.demoProvider;
  }

  /**
   * Executa uma rodada completa de verificação para os perfis ativos e varredura de novos candidatos
   */
  async runCycleNow(isScheduled: boolean = false): Promise<{
    durationMs: number;
    profilesChecked: number;
    newPostsFound: number;
    newOpportunitiesCount: number;
    errorsCount: number;
    details: string;
    skipped?: boolean;
  }> {
    if (this.isMonitoring) {
      if (isScheduled) {
        await db.logSystem(
          'WARN',
          'MONITORING',
          'Varredura agendada ignorada: trava de concorrência (Lock ativo).'
        );
        return {
          durationMs: 0,
          profilesChecked: 0,
          newPostsFound: 0,
          newOpportunitiesCount: 0,
          errorsCount: 0,
          details: 'Execução ignorada: trava de concorrência (Lock) ativa.',
          skipped: true,
        };
      }
      throw new Error('Uma varredura de monitoramento já está em andamento no momento.');
    }

    this.isMonitoring = true;
    const startTime = Date.now();

    try {
      const settings = await db.getSettings();

      // 1. DISCOVERY AUTOMÁTICO
      try {
        await discoveryService.discoverCandidates({
          city: 'Vitória da Conquista',
          category: 'Todas as Categorias',
        });
      } catch (discErr) {
        console.warn('[MonitoringEngine] Aviso na descoberta automática de novos perfis:', discErr);
      }

      const allProfiles = await db.getProfiles();
      const activeProfiles = allProfiles
        .filter((p) => p.monitoringStatus === 'active' || p.monitoringStatus === 'failed' || !p.monitoringStatus)
        .slice(0, settings.monitoring.maxProfilesPerCycle);

      let profilesChecked = 0;
      let newPostsFound = 0;
      let newOpportunitiesCount = 0;
      let errorsCount = 0;
      const errorDetails: string[] = [];

      const isMetaApi = settings.instagram.providerMode === 'meta_graph_api';
      const provider = await this.getActiveProvider();
      const providerName = isMetaApi ? 'Meta Graph API / Apify Híbrido' : provider.name;

      await db.logSystem(
        'INFO',
        'MONITORING',
        `Iniciando ciclo de varredura com ${activeProfiles.length} perfis ativos via ${providerName}${isScheduled ? ' (Agendado)' : ' (Manual)'}.`
      );

      const existingOpps = await db.getOpportunities().catch(() => []);
      const existingOppPubIds = new Set(existingOpps.map((o) => o.publicationId));

      // Loop dinâmico por todos os perfis cadastrados no banco
      for (const profile of activeProfiles) {
        profilesChecked++;
        try {
          const fetchResult = await provider.fetchProfilePosts(profile, {
            accessToken: settings.instagram.accessToken || process.env.META_ACCESS_TOKEN || '',
            pageId: settings.instagram.pageId || process.env.META_PAGE_ID || '',
            apiVersion: settings.instagram.apiVersion || 'v21.0',
          });

          await new Promise((resolve) => setTimeout(resolve, 1500));

          if (!fetchResult.success) {
            errorsCount++;
            errorDetails.push(`@${profile.username}: ${fetchResult.error || 'Erro na consulta do provedor'}`);
            await db.updateProfile(profile.id, { monitoringStatus: 'failed' }).catch(() => {});
            continue;
          }

          const isOwnAccount = profile.username.toLowerCase().includes('vibz');

          for (const postData of fetchResult.posts) {
            try {
              const insertResult = await db.insertPublication(postData);
              const publication = insertResult.publication;
              const isNewlyCreated = insertResult.created;

              if (!publication || !publication.id) continue;

              // Verifica se é post novo OU se ainda é um post recente marcado como 'low' sem oportunidade vinculada
              const needsReevaluation =
                !isNewlyCreated &&
                !isOwnAccount &&
                publication.relevance === 'low' &&
                !existingOppPubIds.has(publication.id) &&
                Date.now() - new Date(publication.publishedAt).getTime() < 7 * 24 * 60 * 60 * 1000;

              if (!isNewlyCreated && !needsReevaluation) {
                continue;
              }

              if (isNewlyCreated) {
                newPostsFound++;
              }

              if (settings.gemini.autoAnalyzeNewPosts || needsReevaluation) {
                try {
                  const analysis = await aiAnalysisService.analyzePublication({
                    caption: publication.caption,
                    username: publication.username,
                    category: profile.category,
                    city: profile.city,
                    publishedAt: publication.publishedAt,
                    bypassCache: needsReevaluation,
                  });

                  await db.updatePublication(publication.id, {
                    analysisStatus: 'analyzed',
                    relevance: analysis.relevance,
                    aiAnalysis: analysis,
                  });

                  const isQualified =
                    !isOwnAccount &&
                    (analysis.is_opportunity || analysis.is_event) &&
                    (analysis.relevance === 'high' || analysis.relevance === 'medium');

                  if (isQualified && !existingOppPubIds.has(publication.id)) {
                    const opp = await db.createOpportunity({
                      publicationId: publication.id,
                      profileId: profile.id,
                      username: profile.username,
                      eventName: analysis.event_name || `Evento em ${profile.displayName}`,
                      category: analysis.category || profile.category,
                      eventDate: analysis.event_date,
                      eventTime: analysis.event_time,
                      city: analysis.city || profile.city,
                      venue: analysis.venue || profile.displayName,
                      artists: analysis.artists || [],
                      summary: analysis.summary,
                      originalUrl: publication.originalUrl,
                      relevance: analysis.relevance,
                      commercialPotential: analysis.commercial_opportunity,
                      suggestedAction: analysis.suggested_action,
                      status: 'Nova',
                      internalNotes: 'Detectada automaticamente pelo motor do Radar Vibz.',
                      isDemo: profile.isDemo,
                    });

                    existingOppPubIds.add(publication.id);
                    newOpportunitiesCount++;

                    const minRel = settings.telegram.minRelevance || 'medium';
                    const shouldNotify =
                      settings.telegram.enabled &&
                      (analysis.relevance === 'high' || (analysis.relevance === 'medium' && minRel !== 'high'));

                    if (shouldNotify) {
                      await notificationService.notifyOpportunity(opp).catch(() => {});
                    }
                  }
                } catch (aiErr) {
                  console.warn(`[AI Analysis Warning] Falha ao analisar post de @${profile.username}:`, aiErr);
                }
              }
            } catch {
              // Ignora duplicados ou blacklistados
            }
          }

          await db
            .updateProfile(profile.id, {
              lastCheckedAt: new Date().toISOString(),
              monitoringStatus: 'active',
            })
            .catch(() => {});
        } catch (err: unknown) {
          errorsCount++;
          const msg = err instanceof Error ? err.message : 'Falha na verificação';
          errorDetails.push(`@${profile.username}: ${msg}`);
          await db.updateProfile(profile.id, { monitoringStatus: 'failed' }).catch(() => {});
        }
      }

      const durationMs = Date.now() - startTime;

      const now = new Date();
      const nextRun = new Date(now.getTime() + settings.monitoring.intervalMinutes * 60 * 1000);
      await db.updateSettings({
        monitoring: {
          ...settings.monitoring,
          lastRunAt: now.toISOString(),
          nextRunAt: nextRun.toISOString(),
        },
      });

      const status = errorsCount === 0 ? 'success' : errorsCount < profilesChecked ? 'partial_failure' : 'failed';
      const details = `Varredura finalizada em ${durationMs}ms. ${profilesChecked} perfis verificados, ${newPostsFound} novas publicações, ${newOpportunitiesCount} novas oportunidades comerciais. ${
        errorsCount > 0 ? `Falhas (${errorsCount}): ${errorDetails.slice(0, 3).join('; ')}` : 'Sem erros.'
      }`;

      await db.addMonitoringLog({
        durationMs,
        profilesChecked,
        newPostsFound,
        errorsCount,
        status,
        details,
        provider: providerName,
      });

      await db.logSystem(
        status === 'success' ? 'SUCCESS' : 'WARN',
        'MONITORING',
        `Ciclo de varredura concluído. ${newPostsFound} publicações novas encontradas, ${newOpportunitiesCount} oportunidades geradas.`
      );

      return {
        durationMs,
        profilesChecked,
        newPostsFound,
        newOpportunitiesCount,
        errorsCount,
        details,
      };
    } finally {
      this.isMonitoring = false;
    }
  }

  public isLocked(): boolean {
    return this.isMonitoring;
  }

  public isBusy(): boolean {
    return this.isMonitoring;
  }
}

export const monitoringEngine = new MonitoringEngine();