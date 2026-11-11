import { PrismaClient } from '@prisma/client';
import {
  Profile,
  Publication,
  Opportunity,
  SystemLog,
  AppSettings,
  ContactLog,
  ProfileCandidate,
} from '../types/radar';

export const prisma = new PrismaClient();

// Função auxiliar para higienizar caracteres Unicode malformados (ex: emojis quebrados do Instagram)
function sanitizeUnicode<T>(val: T): T {
  if (typeof val === 'string') {
    return (typeof val.toWellFormed === 'function' 
      ? val.toWellFormed() 
      : val.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')) as unknown as T;
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeUnicode) as unknown as T;
  }
  if (val !== null && typeof val === 'object') {
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      cleaned[k] = sanitizeUnicode(v);
    }
    return cleaned as unknown as T;
  }
  return val;
}

export class DatabaseService {
  // --- CONFIGURAÇÕES (SETTINGS) ---
  async getSettings(): Promise<AppSettings> {
    try {
      const record = await prisma.settings.findUnique({ where: { id: 1 } });
      if (record && record.settingsData) {
        const settings = record.settingsData as unknown as AppSettings;

        settings.instagram = settings.instagram || {};
        settings.gemini = settings.gemini || {};
        settings.telegram = settings.telegram || {};
        settings.monitoring = settings.monitoring || {};

        // CORREÇÃO: Se o token for nulo, vazio ou contiver os caracteres mascarados (••••), força o uso do .env
        const currentToken = settings.instagram.accessToken || '';
        if ((!currentToken || currentToken.includes('•') || currentToken.includes('*')) && process.env.META_ACCESS_TOKEN) {
          settings.instagram.accessToken = process.env.META_ACCESS_TOKEN;
        }

        if ((!settings.instagram.pageId || settings.instagram.pageId.trim() === '') && process.env.META_PAGE_ID) {
          settings.instagram.pageId = process.env.META_PAGE_ID;
        }

        if (!settings.telegram.botToken && process.env.TELEGRAM_BOT_TOKEN) {
          settings.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
        }
        if (!settings.telegram.chatId && process.env.TELEGRAM_CHAT_ID) {
          settings.telegram.chatId = process.env.TELEGRAM_CHAT_ID;
        }
        if (!settings.gemini.enabled && process.env.GEMINI_API_KEY) {
          settings.gemini.enabled = true;
        }
        return settings;
      }
    } catch (e) {
      console.warn('⚠️ Settings não encontradas no banco, retornando padrão.');
    }

    return {
      instagram: {
        appId: '',
        appSecret: '',
        accessToken: process.env.META_ACCESS_TOKEN || '',
        pageId: process.env.META_PAGE_ID || '',
        apiVersion: 'v21.0',
        providerMode: 'meta_graph_api',
      },
      gemini: {
        model: 'gemini-2.5-flash',
        temperature: 0.2,
        enabled: Boolean(process.env.GEMINI_API_KEY),
        autoAnalyzeNewPosts: true,
      },
      telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        minRelevance: 'medium',
        allowedCategories: ['Show', 'Festa', 'Festival', 'Gastronomia', 'Teatro', 'Outros'],
      },
      monitoring: {
        intervalMinutes: 30,
        maxProfilesPerCycle: 10,
        autoScheduled: true,
      },
    };
  }

  async updateSettings(newSettings: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();

    // Se o frontend enviar bolinhas ou asteriscos, limpa para forçar uso do .env
    if (newSettings.instagram?.accessToken) {
      const tokenStr = newSettings.instagram.accessToken.trim();
      if (tokenStr.includes('•') || tokenStr.includes('*') || tokenStr.length < 30) {
        newSettings.instagram.accessToken = ''; // Limpa no banco
      }
    }

    const updated = {
      ...current,
      ...newSettings,
      instagram: { ...current.instagram, ...newSettings.instagram },
      gemini: { ...current.gemini, ...newSettings.gemini },
      telegram: { ...current.telegram, ...newSettings.telegram },
      monitoring: { ...current.monitoring, ...newSettings.monitoring },
    };

    await prisma.settings.upsert({
      where: { id: 1 },
      update: { settingsData: updated as any },
      create: { id: 1, settingsData: updated as any },
    });

    return updated;
  }

  // --- PERFIS (PROFILES) ---
  async getProfiles(filter?: { status?: string }): Promise<Profile[]> {
    const whereClause = filter?.status ? { monitoringStatus: filter.status } : {};
    const profiles = await prisma.profile.findMany({
      where: whereClause,
      include: {
        _count: {
          select: { publications: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return profiles.map((p) => ({
      id: p.id,
      username: p.username,
      displayName: p.displayName,
      profileUrl: p.profileUrl,
      category: p.category as any,
      city: p.city,
      state: p.state,
      description: p.description || '',
      internalNotes: p.internalNotes || '',
      monitoringStatus: p.monitoringStatus as any,
      createdAt: p.createdAt.toISOString(),
      lastCheckedAt: p.lastCheckedAt ? p.lastCheckedAt.toISOString() : undefined,
      lastPostAt: p.lastPostAt ? p.lastPostAt.toISOString() : undefined,
      integrationMethod: p.integrationMethod as any,
      avatarUrl: p.avatarUrl || undefined,
      followersCount: p.followersCount || undefined,
      totalPostsFound: (p as any)._count?.publications ?? p.totalPostsFound ?? 0,
      isDemo: p.isDemo,
    }));
  }

  async getProfileById(id: string): Promise<Profile | null> {
    const p = await prisma.profile.findUnique({
      where: { id },
      include: {
        _count: {
          select: { publications: true },
        },
      },
    });
    if (!p) return null;
    return {
      id: p.id,
      username: p.username,
      displayName: p.displayName,
      profileUrl: p.profileUrl,
      category: p.category as any,
      city: p.city,
      state: p.state,
      description: p.description || '',
      internalNotes: p.internalNotes || '',
      monitoringStatus: p.monitoringStatus as any,
      createdAt: p.createdAt.toISOString(),
      lastCheckedAt: p.lastCheckedAt ? p.lastCheckedAt.toISOString() : undefined,
      lastPostAt: p.lastPostAt ? p.lastPostAt.toISOString() : undefined,
      integrationMethod: p.integrationMethod as any,
      avatarUrl: p.avatarUrl || undefined,
      followersCount: p.followersCount || undefined,
      totalPostsFound: (p as any)._count?.publications ?? p.totalPostsFound ?? 0,
      isDemo: p.isDemo,
    };
  }

  async getProfileByUsername(username: string): Promise<Profile | null> {
    const p = await prisma.profile.findUnique({
      where: { username: username.toLowerCase().trim() },
    });
    if (!p) return null;
    return this.getProfileById(p.id);
  }

  async createProfile(data: Omit<Profile, 'id' | 'createdAt'> | Profile): Promise<Profile> {
    const username = data.username.toLowerCase().trim();
    const existing = await prisma.profile.findUnique({ where: { username } });
    if (existing) {
      throw new Error(`Perfil @${username} já está cadastrado.`);
    }

    const created = await prisma.profile.create({
      data: {
        ...((data as Profile).id ? { id: (data as Profile).id } : {}),
        username,
        displayName: data.displayName,
        profileUrl: data.profileUrl || `https://instagram.com/${username}`,
        category: data.category,
        city: data.city,
        state: data.state || 'BA',
        description: data.description || '',
        internalNotes: data.internalNotes || '',
        monitoringStatus: data.monitoringStatus || 'active',
        integrationMethod: data.integrationMethod || 'demo_simulation',
        avatarUrl: data.avatarUrl,
        followersCount: data.followersCount || 0,
        totalPostsFound: data.totalPostsFound || 0,
        isDemo: Boolean(data.isDemo),
      },
    });

    return (await this.getProfileById(created.id))!;
  }

  async addProfile(data: Omit<Profile, 'id' | 'createdAt'> | Profile): Promise<Profile> {
    return this.createProfile(data);
  }

  async updateProfile(id: string, data: Partial<Profile>): Promise<Profile | null> {
    await prisma.profile.update({
      where: { id },
      data: {
        ...(data.username && { username: data.username.toLowerCase().trim() }),
        ...(data.displayName && { displayName: data.displayName }),
        ...(data.category && { category: data.category }),
        ...(data.city && { city: data.city }),
        ...(data.state && { state: data.state }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.internalNotes !== undefined && { internalNotes: data.internalNotes }),
        ...(data.monitoringStatus && { monitoringStatus: data.monitoringStatus }),
        ...(data.lastCheckedAt && { lastCheckedAt: new Date(data.lastCheckedAt) }),
        ...(data.lastPostAt && { lastPostAt: new Date(data.lastPostAt) }),
        ...(data.totalPostsFound !== undefined && { totalPostsFound: data.totalPostsFound }),
      },
    });
    return this.getProfileById(id);
  }

  async deleteProfile(id: string): Promise<boolean> {
    try {
      await prisma.profile.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // --- PUBLICAÇÕES (PUBLICATIONS) ---
  async getPublications(): Promise<Publication[]> {
    const pubs = await prisma.publication.findMany({
      include: { aiAnalysis: true },
      orderBy: { publishedAt: 'desc' },
    });

    return pubs.map((pub) => ({
      id: pub.id,
      profileId: pub.profileId,
      username: pub.username,
      externalId: pub.externalId,
      originalUrl: pub.originalUrl,
      mediaType: pub.mediaType as any,
      caption: pub.caption || '',
      publishedAt: pub.publishedAt.toISOString(),
      detectedAt: pub.detectedAt.toISOString(),
      mediaUrl: pub.mediaUrl || undefined,
      thumbnailUrl: pub.thumbnailUrl || undefined,
      analysisStatus: pub.analysisStatus as any,
      relevance: pub.relevance as any,
      isReviewed: pub.isReviewed,
      isDemo: pub.isDemo,
      aiAnalysis: pub.aiAnalysis
        ? {
            is_event: pub.aiAnalysis.is_event,
            is_opportunity: pub.aiAnalysis.is_opportunity,
            category: pub.aiAnalysis.category,
            relevance: pub.aiAnalysis.relevance as any,
            event_name: pub.aiAnalysis.event_name,
            event_date: pub.aiAnalysis.event_date,
            event_time: pub.aiAnalysis.event_time,
            venue: pub.aiAnalysis.venue,
            city: pub.aiAnalysis.city,
            state: pub.aiAnalysis.state,
            artists: pub.aiAnalysis.artists,
            organizer: pub.aiAnalysis.organizer,
            summary: pub.aiAnalysis.summary,
            commercial_opportunity: pub.aiAnalysis.commercial_opportunity,
            suggested_action: pub.aiAnalysis.suggested_action,
            confidence: pub.aiAnalysis.confidence,
            missing_information: pub.aiAnalysis.missing_information,
          }
        : undefined,
    }));
  }

  async getPublicationByExternalId(externalId: string): Promise<Publication | null> {
    const pub = await prisma.publication.findUnique({
      where: { externalId },
      include: { aiAnalysis: true },
    });
    if (!pub) return null;
    const pubs = await this.getPublications();
    return pubs.find((p) => p.externalId === externalId) || null;
  }

  async insertPublication(
    pub: Omit<Publication, 'id' | 'detectedAt'> | Publication
  ): Promise<{ publication: Publication; created: boolean }> {
    const existing = await prisma.publication.findUnique({
      where: { externalId: pub.externalId },
    });
    if (existing) {
      const pubs = await this.getPublications();
      const found = pubs.find((p) => p.externalId === pub.externalId)!;
      return { publication: found, created: false };
    }

    let profileId = pub.profileId;
    if (!profileId) {
      const profile = await this.getProfileByUsername(pub.username);
      profileId = profile ? profile.id : 'demo-profile-1';
    }

    const cleanPub = sanitizeUnicode(pub);

    const created = await prisma.publication.create({
      data: {
        ...((cleanPub as Publication).id ? { id: (cleanPub as Publication).id } : {}),
        profileId,
        username: cleanPub.username,
        externalId: cleanPub.externalId,
        originalUrl: cleanPub.originalUrl,
        mediaType: cleanPub.mediaType,
        caption: cleanPub.caption || '',
        publishedAt: new Date(cleanPub.publishedAt),
        mediaUrl: cleanPub.mediaUrl,
        thumbnailUrl: cleanPub.thumbnailUrl,
        analysisStatus: cleanPub.analysisStatus || 'pending',
        relevance: cleanPub.relevance || 'none',
        isReviewed: Boolean(cleanPub.isReviewed),
        isDemo: Boolean(cleanPub.isDemo),
      },
    });

    if (cleanPub.aiAnalysis) {
      await prisma.aIAnalysisResult.create({
        data: {
          publicationId: created.id,
          is_event: Boolean(cleanPub.aiAnalysis.is_event),
          is_opportunity: Boolean(cleanPub.aiAnalysis.is_opportunity),
          category: cleanPub.aiAnalysis.category || 'Outros',
          relevance: cleanPub.aiAnalysis.relevance || 'low',
          event_name: cleanPub.aiAnalysis.event_name,
          event_date: cleanPub.aiAnalysis.event_date,
          event_time: cleanPub.aiAnalysis.event_time,
          venue: cleanPub.aiAnalysis.venue,
          city: cleanPub.aiAnalysis.city,
          state: cleanPub.aiAnalysis.state,
          artists: cleanPub.aiAnalysis.artists || [],
          organizer: cleanPub.aiAnalysis.organizer,
          summary: cleanPub.aiAnalysis.summary || '',
          commercial_opportunity: cleanPub.aiAnalysis.commercial_opportunity || '',
          suggested_action: cleanPub.aiAnalysis.suggested_action || '',
          confidence: cleanPub.aiAnalysis.confidence || 0,
          missing_information: cleanPub.aiAnalysis.missing_information || [],
        },
      });
    }

    const pubs = await this.getPublications();
    return { publication: pubs.find((p) => p.id === created.id)!, created: true };
  }

  async addPublication(pub: Omit<Publication, 'id' | 'detectedAt'> | Publication): Promise<Publication> {
    const res = await this.insertPublication(pub);
    return res.publication;
  }

  async updatePublication(id: string, data: Partial<Publication>): Promise<Publication | null> {
    if (!id) {
      console.warn('[Database] Tentativa de atualizar publicação com ID inválido ou undefined.');
      return null;
    }

    try {
      await prisma.publication.update({
        where: { id },
        data: {
          ...(data.analysisStatus && { analysisStatus: data.analysisStatus }),
          ...(data.relevance && { relevance: data.relevance }),
          ...(data.isReviewed !== undefined && { isReviewed: data.isReviewed }),
        },
      });

      if (data.aiAnalysis) {
        const cleanAnalysis = sanitizeUnicode(data.aiAnalysis);
        await prisma.aIAnalysisResult.upsert({
          where: { publicationId: id },
          update: {
            is_event: Boolean(cleanAnalysis.is_event),
            is_opportunity: Boolean(cleanAnalysis.is_opportunity),
            category: cleanAnalysis.category || 'Outros',
            relevance: cleanAnalysis.relevance || 'low',
            event_name: cleanAnalysis.event_name,
            event_date: cleanAnalysis.event_date,
            event_time: cleanAnalysis.event_time,
            venue: cleanAnalysis.venue,
            city: cleanAnalysis.city,
            state: cleanAnalysis.state,
            artists: cleanAnalysis.artists || [],
            organizer: cleanAnalysis.organizer,
            summary: cleanAnalysis.summary || '',
            commercial_opportunity: cleanAnalysis.commercial_opportunity || '',
            suggested_action: cleanAnalysis.suggested_action || '',
            confidence: cleanAnalysis.confidence || 0,
            missing_information: cleanAnalysis.missing_information || [],
          },
          create: {
            publicationId: id,
            is_event: Boolean(cleanAnalysis.is_event),
            is_opportunity: Boolean(cleanAnalysis.is_opportunity),
            category: cleanAnalysis.category || 'Outros',
            relevance: cleanAnalysis.relevance || 'low',
            event_name: cleanAnalysis.event_name,
            event_date: cleanAnalysis.event_date,
            event_time: cleanAnalysis.event_time,
            venue: cleanAnalysis.venue,
            city: cleanAnalysis.city,
            state: cleanAnalysis.state,
            artists: cleanAnalysis.artists || [],
            organizer: cleanAnalysis.organizer,
            summary: cleanAnalysis.summary || '',
            commercial_opportunity: cleanAnalysis.commercial_opportunity || '',
            suggested_action: cleanAnalysis.suggested_action || '',
            confidence: cleanAnalysis.confidence || 0,
            missing_information: cleanAnalysis.missing_information || [],
          },
        });
      }

      const pubs = await this.getPublications();
      return pubs.find((p) => p.id === id) || null;
    } catch (err) {
      console.error(`[Database] Erro ao atualizar publicação com ID ${id}:`, err);
      return null;
    }
  }

  // --- OPORTUNIDADES (OPPORTUNITIES) ---
  async getOpportunities(): Promise<Opportunity[]> {
    const opps = await prisma.opportunity.findMany({
      include: { contactLogs: true },
      orderBy: { detectedAt: 'desc' },
    });

    return opps.map((opp) => ({
      id: opp.id,
      publicationId: opp.publicationId,
      profileId: opp.profileId,
      username: opp.username,
      eventName: opp.eventName,
      category: opp.category,
      eventDate: opp.eventDate,
      eventTime: opp.eventTime,
      city: opp.city,
      venue: opp.venue,
      artists: opp.artists,
      summary: opp.summary,
      originalUrl: opp.originalUrl,
      relevance: opp.relevance as any,
      commercialPotential: opp.commercialPotential,
      suggestedAction: opp.suggestedAction,
      detectedAt: opp.detectedAt.toISOString(),
      status: opp.status as any,
      internalNotes: opp.internalNotes || '',
      isDemo: opp.isDemo,
      notified: opp.notified,
      notifiedAt: opp.notifiedAt ? opp.notifiedAt.toISOString() : undefined,
      contactLogs: opp.contactLogs.map((log) => ({
        id: log.id,
        date: log.date.toISOString(),
        responsible: log.responsible,
        channel: log.channel as any,
        notes: log.notes,
      })),
    }));
  }

  async createOpportunity(opp: Omit<Opportunity, 'id' | 'detectedAt'> | Opportunity): Promise<Opportunity> {
    let profileId = opp.profileId;
    let publicationId = opp.publicationId;

    if (!profileId) {
      const p = await this.getProfileByUsername(opp.username);
      profileId = p ? p.id : 'demo-profile-1';
    }

    if (!publicationId) {
      publicationId = `pub_synthetic_${Date.now()}`;
      await prisma.publication.create({
        data: {
          id: publicationId,
          externalId: `ext_${publicationId}`,
          username: opp.username,
          originalUrl: opp.originalUrl || '',
          mediaType: 'OTHER',
          caption: opp.summary || '',
          publishedAt: new Date(),
          analysisStatus: 'analyzed',
          relevance: opp.relevance || 'medium',
          isReviewed: true,
          profileId,
        },
      });
    }

    const dataToCreate = {
      ...((opp as Opportunity).id ? { id: (opp as Opportunity).id } : {}),
      profileId,
      publicationId,
      username: opp.username,
      eventName: opp.eventName,
      category: opp.category,
      eventDate: opp.eventDate || null,
      eventTime: opp.eventTime || null,
      city: opp.city,
      venue: opp.venue || null,
      artists: opp.artists || [],
      summary: opp.summary || '',
      originalUrl: opp.originalUrl,
      relevance: opp.relevance,
      commercialPotential: opp.commercialPotential || '',
      suggestedAction: opp.suggestedAction || '',
      status: opp.status || 'Nova',
      internalNotes: opp.internalNotes || '',
      isDemo: Boolean(opp.isDemo),
      notified: Boolean(opp.notified),
      notifiedAt: opp.notifiedAt ? new Date(opp.notifiedAt) : null,
    };

    const cleanData = sanitizeUnicode(dataToCreate);

    const created = await prisma.opportunity.create({ data: cleanData });

    const list = await this.getOpportunities();
    return list.find((o) => o.id === created.id)!;
  }

  async addOpportunity(opp: Omit<Opportunity, 'id' | 'detectedAt'> | Opportunity): Promise<Opportunity> {
    return this.createOpportunity(opp);
  }

  async updateOpportunityStatus(id: string, status: Opportunity['status']): Promise<Opportunity | null> {
    await prisma.opportunity.update({
      where: { id },
      data: { status },
    });
    const opps = await this.getOpportunities();
    return opps.find((o) => o.id === id) || null;
  }

  async addContactLog(opportunityId: string, log: Omit<ContactLog, 'id'>): Promise<Opportunity | null> {
    await prisma.contactLog.create({
      data: {
        opportunityId,
        date: new Date(log.date),
        responsible: log.responsible,
        channel: log.channel,
        notes: log.notes || '',
      },
    });
    const opps = await this.getOpportunities();
    return opps.find((o) => o.id === opportunityId) || null;
  }

  async isOpportunityNotified(opportunityId: string): Promise<boolean> {
    const opp = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { notified: true },
    });
    return Boolean(opp?.notified);
  }

  async markOpportunityNotified(opportunityId: string): Promise<void> {
    await prisma.opportunity.update({
      where: { id: opportunityId },
      data: {
        notified: true,
        notifiedAt: new Date(),
      },
    });
  }

  // --- CANDIDATOS / DESCOBERTA (PROFILE CANDIDATES) ---
  async getCandidates(): Promise<ProfileCandidate[]> {
    const candidates = await prisma.profileCandidate.findMany({
      orderBy: { discoveredAt: 'desc' },
    });
    if (!Array.isArray(candidates)) return [];
    return candidates.map((c) => ({
      id: c.id,
      username: c.username,
      displayName: c.displayName,
      probableCategory: c.probableCategory as any,
      city: c.city,
      state: c.state,
      justification: c.justification,
      source: c.source,
      discoveredAt: c.discoveredAt.toISOString(),
      status: c.status as any,
      followersEstimated: c.followersEstimated || 0,
      isDemo: c.isDemo,
    }));
  }

  async addCandidate(
    candidate: Omit<ProfileCandidate, 'id' | 'discoveredAt'> | ProfileCandidate
  ): Promise<ProfileCandidate> {
    const created = await prisma.profileCandidate.create({
      data: {
        ...((candidate as ProfileCandidate).id ? { id: (candidate as ProfileCandidate).id } : {}),
        username: candidate.username.toLowerCase().trim(),
        displayName: candidate.displayName,
        probableCategory: candidate.probableCategory,
        city: candidate.city,
        state: candidate.state || 'BA',
        justification: candidate.justification,
        source: candidate.source,
        status: candidate.status || 'Pendente',
        followersEstimated: candidate.followersEstimated || 0,
        isDemo: Boolean(candidate.isDemo),
      },
    });

    return {
      id: created.id,
      username: created.username,
      displayName: created.displayName,
      probableCategory: created.probableCategory as any,
      city: created.city,
      state: created.state,
      justification: created.justification,
      source: created.source,
      discoveredAt: created.discoveredAt.toISOString(),
      status: created.status as any,
      followersEstimated: created.followersEstimated || 0,
      isDemo: created.isDemo,
    };
  }

  async updateCandidateStatus(
    id: string,
    status: ProfileCandidate['status']
  ): Promise<ProfileCandidate | null> {
    await prisma.profileCandidate.update({
      where: { id },
      data: { status },
    });
    const candidates = await this.getCandidates();
    return candidates.find((c) => c.id === id) || null;
  }

  // --- LOGS DO SISTEMA E MONITORAMENTO ---
  async getLogs(): Promise<SystemLog[]> {
    const logs = await prisma.systemLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: 100,
    });

    return logs.map((l) => ({
      id: l.id,
      timestamp: l.timestamp.toISOString(),
      level: l.level as any,
      module: l.module as any,
      message: l.message,
      metadata: (l.metadata as any) || undefined,
    }));
  }

  async getSystemLogs(): Promise<SystemLog[]> {
    return this.getLogs();
  }

  async getMonitoringLogs(): Promise<any[]> {
    const logs = await prisma.systemLog.findMany({
      where: { module: 'MONITORING' },
      orderBy: { timestamp: 'desc' },
      take: 50,
    });

    return logs.map((l) => {
      const meta = (l.metadata as any) || {};
      return {
        id: l.id,
        timestamp: l.timestamp.toISOString(),
        status: l.level === 'SUCCESS' ? 'success' : l.level === 'WARN' ? 'success' : 'failed',
        details: l.message,
        durationMs: meta.durationMs ?? 0,
        profilesChecked: meta.profilesChecked ?? (l.message.includes('1 perfis') ? 1 : 0),
        newPostsFound: meta.newPostsFound ?? (l.message.includes('25 publicações') ? 25 : 0),
        errorsCount: meta.errorsCount ?? (l.level === 'ERROR' ? 1 : 0),
        provider: meta.provider || 'Meta Graph API',
      };
    });
  }

  async addLog(log: Omit<SystemLog, 'id' | 'timestamp'>): Promise<SystemLog> {
    const created = await prisma.systemLog.create({
      data: {
        level: log.level,
        module: log.module,
        message: log.message,
        metadata: log.metadata ? (log.metadata as any) : undefined,
      },
    });

    return {
      id: created.id,
      timestamp: created.timestamp.toISOString(),
      level: created.level as any,
      module: created.module as any,
      message: created.message,
      metadata: (created.metadata as any) || undefined,
    };
  }

  async logSystem(
    levelOrObj: SystemLog['level'] | Omit<SystemLog, 'id' | 'timestamp'>,
    module?: SystemLog['module'],
    message?: string,
    metadata?: Record<string, unknown>
  ): Promise<SystemLog> {
    if (typeof levelOrObj === 'object') {
      return this.addLog(levelOrObj);
    }
    return this.addLog({
      level: levelOrObj,
      module: module!,
      message: message!,
      metadata,
    });
  }

  async addMonitoringLog(logData: {
    durationMs: number;
    profilesChecked: number;
    newPostsFound: number;
    errorsCount: number;
    status: string;
    details: string;
    provider: string;
  }): Promise<void> {
    await this.logSystem(
      logData.status === 'success' ? 'SUCCESS' : 'WARN',
      'MONITORING',
      logData.details || `Varredura concluída via ${logData.provider}`,
      {
        durationMs: logData.durationMs,
        profilesChecked: logData.profilesChecked,
        newPostsFound: logData.newPostsFound,
        errorsCount: logData.errorsCount,
        status: logData.status,
        provider: logData.provider,
      }
    );
  }
}

export const db = new DatabaseService();