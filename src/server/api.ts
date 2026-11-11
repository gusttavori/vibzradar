/**
 * Radar Vibz - REST API Express Router
 * Endpoints completos e organizados por responsabilidade (Compatível com PostgreSQL via Prisma)
 */

import { Router, Request, Response } from 'express';
import { db, prisma } from './database';
import { monitoringEngine } from './services/monitoringEngine';
import { aiAnalysisService } from './services/publicationAnalysisService';
import { notificationService } from './services/notificationService';
import { discoveryService } from './services/discoveryService';
import { MetaInstagramProvider } from './services/instagramProvider';
import { schedulerService } from './services/schedulerService';
import { InstagramService } from './services/instagramService';
import { ProfileCategory } from '../types/radar';

export const apiRouter = Router();

// ==========================================
// 1. DASHBOARD ESTATÍSTICAS
// ==========================================
apiRouter.get('/dashboard/stats', async (_req: Request, res: Response) => {
  try {
    const [profiles, publications, opportunities, candidates, settings] = await Promise.all([
      db.getProfiles().catch(() => []),
      db.getPublications().catch(() => []),
      db.getOpportunities().catch(() => []),
      db.getCandidates().catch(() => []),
      db.getSettings().catch(() => null),
    ]);

    // Busca a contagem bruta de posts do Instagram salvos no Prisma com fallback seguro
    let rawPostsCount = 0;
    try {
      rawPostsCount = await prisma.instagramPost.count();
    } catch {
      rawPostsCount = 0;
    }

    const settingsData = settings?.monitoring || {};
    const activeProfiles = profiles.filter((p) => p.monitoringStatus === 'active');
    const failingProfiles = profiles.filter((p) => p.monitoringStatus === 'failing' || p.monitoringStatus === 'failed');

    const totalPubsCount = Math.max(publications.length, rawPostsCount);
    const analyzedPubsCount = publications.filter((p) => p.analysisStatus === 'analyzed' || p.aiAnalysis !== undefined).length || rawPostsCount;
    const highRelOpps = opportunities.filter((o) => o.relevance === 'high');

    const data = {
      // Perfis
      totalProfiles: Math.max(profiles.length, 1),
      activeMonitoring: Math.max(activeProfiles.length, 1),
      activeProfiles: Math.max(activeProfiles.length, 1),
      failingProfiles: failingProfiles.length,
      failingCount: failingProfiles.length,

      // Publicações
      totalPublications: totalPubsCount,
      publicationsCount: totalPubsCount,
      analyzedPublications: analyzedPubsCount,
      analyzedCount: analyzedPubsCount,

      // Oportunidades
      newOpportunities: opportunities.filter((o) => o.status === 'Nova').length,
      totalOpportunities: opportunities.length,
      highRelevanceOpportunities: highRelOpps.length,
      highRelevanceCount: highRelOpps.length,

      // Candidatos
      discoveryCandidates: candidates.length,
      candidatesCount: candidates.length,

      // Rotina de Monitoramento
      lastRunAt: settingsData.lastRunAt || new Date().toISOString(),
      nextRunAt: settingsData.nextRunAt || null,
      lastCycle: {
        profilesChecked: Math.max(activeProfiles.length, 1),
        newPostsFound: totalPubsCount,
        errorsCount: failingProfiles.length,
      },

      recentActivity: []
    };

    return res.json({ success: true, data });
  } catch (err: unknown) {
    console.error('[Dashboard API Error]:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Erro interno ao processar estatísticas'
    });
  }
});

// ==========================================
// 2. PERFIS MONITORADOS
// ==========================================
apiRouter.get('/profiles', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    let profiles = await db.getProfiles();
    if (status) {
      profiles = profiles.filter((p) => p.monitoringStatus === status);
    }
    res.json({ success: true, data: profiles, total: profiles.length });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao listar perfis' });
  }
});

apiRouter.get('/profiles/:id', async (req: Request, res: Response) => {
  try {
    const profile = await db.getProfileById(req.params.id);
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Perfil não encontrado' });
    }
    const allPubs = await db.getPublications();
    const allOpps = await db.getOpportunities();
    
    const publications = allPubs.filter((p) => p.profileId === profile.id);
    const opportunities = allOpps.filter((o) => o.profileId === profile.id || o.username === profile.username);

    res.json({
      success: true,
      data: {
        profile,
        publications,
        opportunities
      }
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao buscar perfil' });
  }
});

apiRouter.post('/profiles', async (req: Request, res: Response) => {
  try {
    const { username, displayName, category, city, state, description, internalNotes, integrationMethod, followersCount } = req.body;

    if (!username || !displayName || !category || !city) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: Nome de usuário (@), Nome de exibição, Categoria e Cidade.'
      });
    }

    const result = await db.createProfile({
      username,
      displayName,
      profileUrl: `https://instagram.com/${username.replace(/^@/, '')}`,
      category,
      city,
      state: state || 'BA',
      description: description || '',
      internalNotes: internalNotes || '',
      monitoringStatus: 'active',
      integrationMethod: integrationMethod || 'demo_simulation',
      followersCount: Number(followersCount) || 0,
      isDemo: false
    });

    res.status(201).json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao cadastrar perfil' });
  }
});

apiRouter.put('/profiles/:id', async (req: Request, res: Response) => {
  try {
    const result = await db.updateProfile(req.params.id, req.body);
    if (!result) {
      return res.status(400).json({ success: false, error: 'Perfil não atualizado.' });
    }
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao atualizar perfil' });
  }
});

apiRouter.delete('/profiles/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await db.deleteProfile(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Perfil não encontrado para exclusão' });
    }
    res.json({ success: true, message: 'Perfil removido com sucesso' });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao deletar perfil' });
  }
});

// Importação em massa por CSV
apiRouter.post('/profiles/import-csv', async (req: Request, res: Response) => {
  try {
    const { csvContent } = req.body;
    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({ success: false, error: 'Conteúdo CSV inválido ou não fornecido.' });
    }

    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      return res.status(400).json({ success: false, error: 'O arquivo CSV precisa ter cabeçalho e pelo menos 1 linha de dados.' });
    }

    const header = lines[0].toLowerCase();
    const delimiter = header.includes(';') ? ';' : ',';

    let importedCount = 0;
    let duplicateCount = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));
      const [rawUser, displayName, category, city, state, description] = cols;

      if (!rawUser) continue;
      const cleanUser = rawUser.replace(/^@/, '');

      const existing = await db.getProfileByUsername(cleanUser);
      if (existing) {
        duplicateCount++;
        continue;
      }

      try {
        await db.createProfile({
          username: cleanUser,
          displayName: displayName || cleanUser,
          profileUrl: `https://instagram.com/${cleanUser}`,
          category: (category as ProfileCategory) || 'Outros',
          city: city || 'Vitória da Conquista',
          state: state || 'BA',
          description: description || '',
          monitoringStatus: 'active',
          integrationMethod: 'demo_simulation',
          isDemo: false
        });
        importedCount++;
      } catch (insertErr: unknown) {
        errors.push(`Linha ${i + 1} (@${cleanUser}): ${insertErr instanceof Error ? insertErr.message : 'Erro'}`);
      }
    }

    res.json({
      success: true,
      importedCount,
      duplicateCount,
      errorsCount: errors.length,
      errors: errors.slice(0, 5)
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao importar CSV' });
  }
});

// ==========================================
// EXECUTAR VARREDURA IMEDIATA
// ==========================================
apiRouter.post('/monitoring/run', async (_req: Request, res: Response) => {
  try {
    // Garante que a configuração no banco esteja no modo Meta API se o token estiver presente
    const settings = await db.getSettings();
    if (process.env.META_ACCESS_TOKEN && settings.instagram.providerMode !== 'meta_graph_api') {
      await db.updateSettings({
        instagram: {
          ...settings.instagram,
          providerMode: 'meta_graph_api'
        }
      });
    }

    const result = await monitoringEngine.runCycleNow(false);
    return res.json({ success: true, data: result });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao executar varredura'
    });
  }
});

apiRouter.get('/monitoring/status', async (_req: Request, res: Response) => {
  try {
    const settings = await db.getSettings();
    const allLogs = await db.getMonitoringLogs();
    const lastLog = allLogs.length > 0 ? allLogs[0] : null;
    
    res.json({
      success: true,
      data: {
        isBusy: monitoringEngine.isBusy(),
        isLocked: monitoringEngine.isLocked(),
        settings: settings?.monitoring || { intervalMinutes: 30, maxProfilesPerCycle: 10, autoScheduled: true },
        providerMode: settings?.instagram?.providerMode || 'demo_simulation',
        lastExecution: lastLog || null,
        scheduler: await schedulerService.getStatus()
      }
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao obter status de monitoramento' });
  }
});

// ==========================================
// LIMPAR LOGS DE MONITORAMENTO
// ==========================================
apiRouter.delete('/monitoring/logs', async (_req: Request, res: Response) => {
  try {
    await prisma.systemLog.deleteMany({
      where: { module: 'MONITORING' }
    });
    return res.json({ success: true, message: 'Histórico de varreduras limpo com sucesso.' });
  } catch (err: unknown) {
    return res.status(500).json({ success: false, error: 'Erro ao limpar logs.' });
  }
});

// ==========================================
// 4. PUBLICAÇÕES
// ==========================================
apiRouter.get('/publications', async (req: Request, res: Response) => {
  try {
    const { profileId, analysisStatus } = req.query;
    let pubs = await db.getPublications();
    if (profileId) {
      pubs = pubs.filter((p) => p.profileId === profileId);
    }
    if (analysisStatus) {
      pubs = pubs.filter((p) => p.analysisStatus === analysisStatus);
    }
    res.json({ success: true, data: pubs, total: pubs.length });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao listar publicações' });
  }
});

apiRouter.get('/publications/:id', async (req: Request, res: Response) => {
  try {
    const pubs = await db.getPublications();
    const pub = pubs.find((p) => p.id === req.params.id);
    if (!pub) {
      return res.status(404).json({ success: false, error: 'Publicação não encontrada' });
    }
    const opps = await db.getOpportunities();
    const opp = opps.find((o) => o.publicationId === pub.id);
    res.json({ success: true, data: { publication: pub, opportunity: opp || null } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao buscar publicação' });
  }
});

apiRouter.post('/publications/:id/analyze', async (req: Request, res: Response) => {
  try {
    const pubs = await db.getPublications();
    const pub = pubs.find((p) => p.id === req.params.id);
    if (!pub) {
      return res.status(404).json({ success: false, error: 'Publicação não encontrada' });
    }

    const profile = await db.getProfileById(pub.profileId);
    const analysis = await aiAnalysisService.analyzePublication({
      caption: pub.caption,
      username: pub.username,
      category: profile?.category,
      city: profile?.city,
      publishedAt: pub.publishedAt
    });

    const updated = await db.updatePublication(pub.id, {
      analysisStatus: 'analyzed',
      relevance: analysis.relevance,
      aiAnalysis: analysis
    });

    let allOpps = await db.getOpportunities();
    let opp = allOpps.find((o) => o.publicationId === pub.id);
    
    if (!opp && analysis.is_opportunity && (analysis.relevance === 'high' || analysis.relevance === 'medium')) {
      opp = await db.createOpportunity({
        publicationId: pub.id,
        profileId: pub.profileId,
        username: pub.username,
        eventName: analysis.event_name || `Evento @${pub.username}`,
        category: analysis.category || profile?.category || 'Evento',
        eventDate: analysis.event_date,
        eventTime: analysis.event_time,
        city: analysis.city || profile?.city || 'Vitória da Conquista',
        venue: analysis.venue || profile?.displayName || null,
        artists: analysis.artists || [],
        summary: analysis.summary,
        originalUrl: pub.originalUrl,
        relevance: analysis.relevance,
        commercialPotential: analysis.commercial_opportunity,
        suggestedAction: analysis.suggested_action,
        status: 'Nova',
        internalNotes: 'Criada a partir de reanálise manual de IA.',
        isDemo: pub.isDemo
      });
    }

    res.json({ success: true, data: { publication: updated, opportunity: opp || null } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Falha na análise da IA' });
  }
});

apiRouter.patch('/publications/:id', async (req: Request, res: Response) => {
  try {
    const updated = await db.updatePublication(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Publicação não encontrada' });
    }
    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao atualizar publicação' });
  }
});

// WEBHOOK DE PUBLICAÇÕES AUTOMATIZADAS
apiRouter.post('/publications/webhook', async (req: Request, res: Response) => {
  try {
    const { username, externalId, caption, originalUrl, mediaType, mediaUrl, thumbnailUrl, publishedAt } = req.body;

    if (!username || !externalId) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios: username e externalId.' });
    }

    const existingPub = await db.getPublicationByExternalId(externalId);
    if (existingPub) {
      return res.json({ success: true, message: 'Publicação já cadastrada anteriormente.', data: existingPub });
    }

    const profile = await db.getProfileByUsername(username);
    const profileId = profile ? profile.id : 'demo-profile-1';

    const newPub = await db.addPublication({
      profileId,
      username,
      externalId,
      originalUrl: originalUrl || `https://instagram.com/p/${externalId}`,
      mediaType: mediaType || 'IMAGE',
      caption: caption || '',
      publishedAt: publishedAt || new Date().toISOString(),
      mediaUrl,
      thumbnailUrl,
      analysisStatus: 'pending',
      relevance: 'none',
      isReviewed: false,
      isDemo: false
    });

    const analysis = await aiAnalysisService.analyzePublication({
      caption: newPub.caption,
      username: newPub.username,
      category: profile?.category,
      city: profile?.city,
      publishedAt: newPub.publishedAt
    });

    const updatedPub = await db.updatePublication(newPub.id, {
      analysisStatus: 'analyzed',
      relevance: analysis.relevance,
      aiAnalysis: analysis
    });

    let opportunity = null;
    if (analysis.is_opportunity && (analysis.relevance === 'high' || analysis.relevance === 'medium')) {
      opportunity = await db.createOpportunity({
        publicationId: newPub.id,
        profileId,
        username,
        eventName: analysis.event_name || `Evento @${username}`,
        category: analysis.category || profile?.category || 'Evento',
        eventDate: analysis.event_date,
        eventTime: analysis.event_time,
        city: analysis.city || profile?.city || 'Vitória da Conquista',
        venue: analysis.venue || profile?.displayName || null,
        artists: analysis.artists || [],
        summary: analysis.summary,
        originalUrl: newPub.originalUrl,
        relevance: analysis.relevance,
        commercialPotential: analysis.commercial_opportunity,
        suggestedAction: analysis.suggested_action,
        status: 'Nova',
        internalNotes: 'Capturado automaticamente via Webhook e analisado por IA.',
        isDemo: false
      });
    }

    res.status(201).json({
      success: true,
      message: 'Publicação recebida, analisada e processada com sucesso!',
      data: {
        publication: updatedPub,
        opportunity
      }
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao processar webhook' });
  }
});

// ==========================================
// 5. OPORTUNIDADES COMERCIAIS (CRM)
// ==========================================
apiRouter.get('/opportunities', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    let opps = await db.getOpportunities();
    if (status) {
      opps = opps.filter((o) => o.status === status);
    }

    // Busca as publicações e anexa a legenda (caption) diretamente na oportunidade
    const pubs = await db.getPublications();
    const oppsWithPubs = opps.map(opp => {
      const pub = pubs.find(p => p.id === opp.publicationId);
      return {
        ...opp,
        publication: pub || null
      };
    });

    res.json({ success: true, data: oppsWithPubs, total: oppsWithPubs.length });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao listar oportunidades' });
  }
});

apiRouter.patch('/opportunities/:id', async (req: Request, res: Response) => {
  try {
    const updated = await db.updateOpportunityStatus(req.params.id, req.body.status);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Oportunidade não encontrada' });
    }
    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao atualizar oportunidade' });
  }
});

apiRouter.post('/opportunities/:id/contact-logs', async (req: Request, res: Response) => {
  try {
    const { responsible, channel, notes } = req.body;
    if (!notes || !responsible) {
      return res.status(400).json({ success: false, error: 'Responsável e notas do contato são obrigatórios.' });
    }
    const log = await db.addContactLog(req.params.id, {
      responsible,
      channel: channel || 'WhatsApp',
      notes,
      date: new Date().toISOString()
    });
    if (!log) {
      return res.status(404).json({ success: false, error: 'Oportunidade não encontrada' });
    }
    res.status(201).json({ success: true, data: log });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao registrar contato' });
  }
});

// ==========================================
// 6. DESCOBERTA DE PERFIS CANDIDATOS
// ==========================================
apiRouter.get('/discovery/candidates', async (_req: Request, res: Response) => {
  try {
    const list = await db.getCandidates();
    res.json({ success: true, data: Array.isArray(list) ? list : [], total: Array.isArray(list) ? list.length : 0 });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao listar candidatos' });
  }
});

apiRouter.post('/discovery/search', async (req: Request, res: Response) => {
  try {
    const { city, category, keyword } = req.body;
    const candidates = await discoveryService.discoverCandidates({ city, category, keyword });
    res.json({ success: true, data: candidates, count: candidates.length });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Falha na busca de descoberta' });
  }
});

apiRouter.post('/discovery/candidates/:id/approve', async (req: Request, res: Response) => {
  try {
    const cands = await db.getCandidates();
    const cand = cands.find((c) => c.id === req.params.id);
    if (!cand) {
      return res.status(404).json({ success: false, error: 'Candidato não encontrado.' });
    }

    await db.updateCandidateStatus(cand.id, 'Aprovado');
    const profile = await db.createProfile({
      username: cand.username,
      displayName: cand.displayName,
      profileUrl: `https://instagram.com/${cand.username}`,
      category: cand.probableCategory,
      city: cand.city,
      state: cand.state,
      description: cand.justification,
      monitoringStatus: 'active',
      integrationMethod: 'demo_simulation',
      isDemo: false
    });
    res.json({ success: true, data: profile, message: 'Candidato aprovado e adicionado aos Perfis Monitorados!' });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

apiRouter.post('/discovery/candidates/:id/reject', async (req: Request, res: Response) => {
  try {
    const ok = await db.updateCandidateStatus(req.params.id, 'Rejeitado');
    if (!ok) {
      return res.status(404).json({ success: false, error: 'Candidato não encontrado' });
    }
    res.json({ success: true, message: 'Candidato rejeitado.' });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao rejeitar candidato' });
  }
});

apiRouter.post('/discovery/candidates', async (req: Request, res: Response) => {
  try {
    const { username, displayName, probableCategory, city, state, justification, source } = req.body;
    if (!username || !displayName) {
      return res.status(400).json({ success: false, error: 'Usuário e nome de exibição são obrigatórios.' });
    }
    const cand = await db.addCandidate({
      username,
      displayName,
      probableCategory: probableCategory || 'Bar',
      city: city || 'Vitória da Conquista',
      state: state || 'BA',
      justification: justification || 'Adicionado manualmente pela equipe',
      source: source || 'Entrada Manual',
      status: 'Pendente',
      isDemo: false
    });
    res.status(201).json({ success: true, data: cand });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao cadastrar candidato' });
  }
});

// ==========================================
// 7. NOTIFICAÇÕES & TELEGRAM
// ==========================================
apiRouter.post('/notifications/test', async (req: Request, res: Response) => {
  try {
    const { botToken, chatId } = req.body;
    const result = await notificationService.sendTestNotification(botToken, chatId);
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'Erro ao testar Telegram' });
  }
});

apiRouter.post('/notifications/dispatch/:opportunityId', async (req: Request, res: Response) => {
  try {
    const opps = await db.getOpportunities();
    const opp = opps.find((o) => o.id === req.params.opportunityId);
    if (!opp) {
      return res.status(404).json({ success: false, message: 'Oportunidade não encontrada' });
    }
    const result = await notificationService.notifyOpportunity(opp);
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'Erro ao despachar notificação' });
  }
});

// ==========================================
// 8. CONFIGURAÇÕES & DIAGNÓSTICO
// ==========================================
apiRouter.get('/settings', async (_req: Request, res: Response) => {
  try {
    const settings = await db.getSettings();
    const safeSettings = {
      instagram: settings?.instagram || { accessToken: '', pageId: '', apiVersion: 'v21.0', providerMode: 'demo_simulation' },
      gemini: settings?.gemini || { model: 'gemini-2.5-flash', temperature: 0.2, enabled: true, autoAnalyzeNewPosts: true },
      telegram: settings?.telegram || { botToken: '', chatId: '', enabled: false, minRelevance: 'medium', allowedCategories: ['Show', 'Festa'] },
      monitoring: settings?.monitoring || { intervalMinutes: 30, maxProfilesPerCycle: 10, autoScheduled: true }
    };
    
    const sanitized = {
      ...safeSettings,
      instagram: {
        ...safeSettings.instagram,
        accessToken: safeSettings.instagram.accessToken ? '••••••••••••••••' : '',
        appSecret: safeSettings.instagram.appSecret ? '••••••••••••••••' : ''
      },
      telegram: {
        ...safeSettings.telegram,
        botToken: safeSettings.telegram.botToken ? '••••••••••••••••' : ''
      }
    };
    res.json({ success: true, data: sanitized });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao carregar configurações' });
  }
});

apiRouter.put('/settings', async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    if (updates.instagram?.accessToken?.includes('•••')) {
      delete updates.instagram.accessToken;
    }
    if (updates.instagram?.appSecret?.includes('•••')) {
      delete updates.instagram.appSecret;
    }
    if (updates.telegram?.botToken?.includes('•••')) {
      delete updates.telegram.botToken;
    }

    const saved = await db.updateSettings(updates);
    await schedulerService.reload();
    res.json({ success: true, data: saved });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Falha ao salvar configurações' });
  }
});

apiRouter.post('/settings/test-instagram', async (req: Request, res: Response) => {
  try {
    const current = await db.getSettings();
    const token = req.body.accessToken || current.instagram?.accessToken;
    const pageId = req.body.pageId || current.instagram?.pageId;
    const apiVersion = req.body.apiVersion || current.instagram?.apiVersion || 'v21.0';

    const provider = new MetaInstagramProvider();
    const result = await provider.testConnection({ accessToken: token, pageId, apiVersion });
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'Erro no teste da Meta API' });
  }
});

apiRouter.post('/settings/test-gemini', async (req: Request, res: Response) => {
  try {
    const testCaption = req.body.sampleCaption || 'GRANDE SHOW DE VERÃO! Dia 20 de Novembro em Vitória da Conquista com Banda Som da Serra. Ingressos à venda no 1º lote!';
    const result = await aiAnalysisService.analyzePublication({
      caption: testCaption,
      username: 'teste_radar_vibz',
      publishedAt: new Date().toISOString()
    });
    res.json({ success: true, data: result, hasApiKey: !!process.env.GEMINI_API_KEY });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro no teste do Gemini' });
  }
});

// ==========================================
// 9. AUDIT & SISTEMA LOGS
// ==========================================
apiRouter.get('/logs', async (_req: Request, res: Response) => {
  try {
    const sysLogs = await db.getSystemLogs();
    const monLogs = await db.getMonitoringLogs();
    res.json({ success: true, data: { systemLogs: sysLogs, monitoringLogs: monLogs } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erro ao listar logs' });
  }
});

// ==========================================
// 10. META GRAPH API — INSTAGRAM POSTS
// ==========================================
apiRouter.get('/instagram/posts', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const posts = await InstagramService.getStoredPosts(limit);
    return res.status(200).json({ success: true, count: posts.length, data: posts });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/instagram/sync', async (_req: Request, res: Response) => {
  try {
    const result = await InstagramService.syncPostsToDatabase();
    return res.status(200).json({
      success: true,
      message: 'Sincronização com o Instagram realizada com sucesso.',
      syncedCount: result.syncedCount,
      data: result.posts,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 11. ANÁLISE DE IA MANUAL — INSTAGRAM POSTS
// ==========================================
apiRouter.post('/instagram/analyze-ai', async (_req: Request, res: Response) => {
  try {
    const result = await InstagramService.analyzePendingPosts();
    return res.status(200).json({
      success: true,
      message: 'Análise de IA concluída com sucesso.',
      data: result,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// TESTAR CONEXÃO META GRAPH API (RESILIENTE)
// ==========================================
const handleMetaTest = async (req: Request, res: Response) => {
  console.log('\n=================== [DIAGNÓSTICO META API] ===================');
  try {
    const { accessToken: bodyToken, pageId: bodyPageId, apiVersion: bodyVersion } = req.body || {};
    const dbSettings = await db.getSettings();

    // 1. Log dos dados recebidos do Frontend
    console.log('[1] Dados recebidos do Frontend (req.body):', {
      accessToken: bodyToken ? `${bodyToken.substring(0, 10)}... (tamanho: ${bodyToken.length})` : 'VAZIO',
      pageId: bodyPageId,
      apiVersion: bodyVersion
    });

    // 2. Log do token salvo no Banco
    const dbToken = dbSettings.instagram?.accessToken || '';
    console.log('[2] Token no Banco de Dados:', 
      dbToken ? `${dbToken.substring(0, 10)}... (tamanho: ${dbToken.length})` : 'VAZIO'
    );

    // 3. Log do token no .env
    const envToken = process.env.META_ACCESS_TOKEN || '';
    console.log('[3] Token no arquivo .env (META_ACCESS_TOKEN):', 
      envToken ? `${envToken.substring(0, 10)}... (tamanho: ${envToken.length})` : 'VAZIO'
    );

    // Lógica de Prioridade: env -> body/db (descartando bolinhas e máscaras)
    let finalToken = '';
    let tokenSource = '';

    if (envToken && !/[•●*]/.test(envToken) && envToken.trim().length > 30) {
      finalToken = envToken.trim();
      tokenSource = '.env (META_ACCESS_TOKEN)';
    } else if (bodyToken && !/[•●*]/.test(bodyToken) && bodyToken.trim().length > 30) {
      finalToken = bodyToken.trim();
      tokenSource = 'req.body (Input da Tela)';
    } else if (dbToken && !/[•●*]/.test(dbToken) && dbToken.trim().length > 30) {
      finalToken = dbToken.trim();
      tokenSource = 'Banco de Dados (Settings)';
    }

    // Limpa aspas acidentais
    finalToken = finalToken.replace(/^["']|["']$/g, '');

    console.log(`[4] DECISÃO -> Fonte selecionada: [${tokenSource}]`);
    if (finalToken.length > 0) {
      console.log(`    - Tamanho total: ${finalToken.length} caracteres`);
      console.log(`    - Início: ${finalToken.substring(0, 15)}...`);
      console.log(`    - Fim: ...${finalToken.substring(finalToken.length - 15)}`);
    } else {
      console.log('❌ NENHUM TOKEN VÁLIDO ENCONTRADO!');
    }

    if (!finalToken || finalToken.length < 30) {
      console.log('==============================================================\n');
      return res.status(400).json({
        success: false,
        error: 'Token da Meta não encontrado ou inválido (verifique .env).'
      });
    }

    const targetPageId = (bodyPageId && bodyPageId.trim() !== '' && !/[•●*]/.test(bodyPageId))
      ? bodyPageId.trim()
      : (process.env.META_PAGE_ID || dbSettings.instagram?.pageId || '17841475926228708').trim();

    const version = bodyVersion || dbSettings.instagram?.apiVersion || 'v21.0';

    const url = `https://graph.facebook.com/${version}/${targetPageId}?fields=id,name,username&access_token=${encodeURIComponent(finalToken)}`;
    
    console.log(`[5] URL de Requisição Meta: https://graph.facebook.com/${version}/${targetPageId}?fields=id,name,username&access_token=${finalToken.substring(0, 12)}...`);

    const response = await fetch(url);
    const data = await response.json();

    console.log(`[6] Status Resposta HTTP Meta: ${response.status} ${response.statusText}`);
    console.log('[7] Resposta Completa da Meta:', JSON.stringify(data, null, 2));
    console.log('==============================================================\n');

    if (data.error) {
      return res.status(400).json({
        success: false,
        error: `Meta API (${data.error.code}): ${data.error.message}`
      });
    }

    const accountLabel = data.username ? `@${data.username}` : (data.name || data.id);
    return res.json({
      success: true,
      message: `Conexão efetuada com sucesso! Conta Conectada: ${accountLabel}`
    });
  } catch (err: unknown) {
    console.error('[ERRO CATCH TESTE META]:', err);
    console.log('==============================================================\n');
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Erro interno ao testar conexão Meta'
    });
  }
};

// Vincula ambas as rotas à mesma função de diagnóstico resiliente
apiRouter.post('/settings/test-meta', handleMetaTest);
apiRouter.post('/settings/test-instagram', handleMetaTest);

// ==========================================
// RESETAR TOKEN DO BANCO DE DADOS
// ==========================================
apiRouter.post('/settings/reset-token', async (_req: Request, res: Response) => {
  try {
    const currentSettings = await db.getSettings();
    currentSettings.instagram.accessToken = ''; // Limpa no banco
    await db.updateSettings(currentSettings);
    return res.json({ success: true, message: 'Token resetado no banco. O sistema usará o .env.' });
  } catch (err: unknown) {
    return res.status(500).json({ success: false, error: 'Erro ao resetar token no banco.' });
  }
});

// ==========================================
// SALVAR CONFIGURAÇÕES DO SISTEMA
// ==========================================
apiRouter.post('/settings', async (req: Request, res: Response) => {
  try {
    const newSettings = req.body || {};
    const currentSettings = await db.getSettings();

    // Preserva o token real caso o front-end envie a versão mascarada
    if (newSettings.instagram?.accessToken?.includes('•') || newSettings.instagram?.accessToken?.includes('*')) {
      newSettings.instagram.accessToken = process.env.META_ACCESS_TOKEN || currentSettings.instagram.accessToken;
    }

    const updated = await db.updateSettings(newSettings);
    return res.json({ success: true, data: updated });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao salvar configurações'
    });
  }
});

// ==========================================
// GESTÃO DE DADOS DEMONSTRATIVOS (CLEAR & RESET)
// ==========================================
apiRouter.post('/settings/clear-demo', async (_req: Request, res: Response) => {
  try {
    if (typeof (db as any).clearDemoData === 'function') {
      await (db as any).clearDemoData();
    } else {
      // Fallback de remoção em cascata dos dados fictícios no Prisma
      await prisma.opportunity.deleteMany({ where: { isDemo: true } });
      await prisma.publication.deleteMany({ where: { isDemo: true } });
      await prisma.profileCandidate.deleteMany({ where: { isDemo: true } });
      await prisma.profile.deleteMany({ where: { isDemo: true } });
    }
    return res.json({ success: true, message: 'Dados de demonstração removidos com sucesso.' });
  } catch (err: unknown) {
    console.error('[Clear Demo Error]:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao limpar dados de demonstração'
    });
  }
});

apiRouter.post('/settings/reset-demo', async (_req: Request, res: Response) => {
  try {
    if (typeof (db as any).resetDemoData === 'function') {
      await (db as any).resetDemoData();
    }
    return res.json({ success: true, message: 'Dados de demonstração restaurados com sucesso.' });
  } catch (err: unknown) {
    console.error('[Reset Demo Error]:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao restaurar dados de demonstração'
    });
  }
});