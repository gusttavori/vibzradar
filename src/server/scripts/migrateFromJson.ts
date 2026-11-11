import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const jsonPath = path.resolve(process.cwd(), 'data/radar_db.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('Arquivo data/radar_db.json não encontrado!');
    return;
  }

  const rawData = fs.readFileSync(jsonPath, 'utf-8');
  const db = JSON.parse(rawData);

  console.log('🚀 Iniciando migração de dados do JSON para o Neon PostgreSQL...');

  // 1. Settings
  if (db.settings) {
    await prisma.settings.upsert({
      where: { id: 1 },
      update: { settingsData: db.settings },
      create: { id: 1, settingsData: db.settings },
    });
    console.log('✔ Configurações migradas com sucesso.');
  }

  // 2. Profiles
  if (Array.isArray(db.profiles)) {
    for (const p of db.profiles) {
      await prisma.profile.upsert({
        where: { id: p.id },
        update: {},
        create: {
          id: p.id,
          username: p.username,
          displayName: p.displayName,
          profileUrl: p.profileUrl,
          category: p.category,
          city: p.city,
          state: p.state,
          description: p.description || '',
          internalNotes: p.internalNotes || '',
          monitoringStatus: p.monitoringStatus,
          createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
          lastCheckedAt: p.lastCheckedAt ? new Date(p.lastCheckedAt) : null,
          lastPostAt: p.lastPostAt ? new Date(p.lastPostAt) : null,
          integrationMethod: p.integrationMethod,
          avatarUrl: p.avatarUrl,
          followersCount: p.followersCount || 0,
          totalPostsFound: p.totalPostsFound || 0,
          isDemo: Boolean(p.isDemo),
        },
      });
    }
    console.log(`✔ ${db.profiles.length} perfis migrados.`);
  }

  // 3. Publications
  if (Array.isArray(db.publications)) {
    for (const pub of db.publications) {
      await prisma.publication.upsert({
        where: { id: pub.id },
        update: {},
        create: {
          id: pub.id,
          externalId: pub.externalId,
          username: pub.username,
          originalUrl: pub.originalUrl,
          mediaType: pub.mediaType,
          caption: pub.caption || '',
          publishedAt: new Date(pub.publishedAt),
          detectedAt: pub.detectedAt ? new Date(pub.detectedAt) : new Date(),
          mediaUrl: pub.mediaUrl,
          thumbnailUrl: pub.thumbnailUrl,
          analysisStatus: pub.analysisStatus,
          relevance: pub.relevance,
          isReviewed: Boolean(pub.isReviewed),
          isDemo: Boolean(pub.isDemo),
          profileId: pub.profileId,
        },
      });

      if (pub.aiAnalysis) {
        const ai = pub.aiAnalysis;
        await prisma.aIAnalysisResult.upsert({
          where: { publicationId: pub.id },
          update: {},
          create: {
            publicationId: pub.id,
            is_event: Boolean(ai.is_event),
            is_opportunity: Boolean(ai.is_opportunity),
            category: ai.category || 'Outros',
            relevance: ai.relevance || 'low',
            event_name: ai.event_name || null,
            event_date: ai.event_date || null,
            event_time: ai.event_time || null,
            venue: ai.venue || null,
            city: ai.city || null,
            state: ai.state || null,
            artists: ai.artists || [],
            organizer: ai.organizer || null,
            summary: ai.summary || '',
            commercial_opportunity: ai.commercial_opportunity || '',
            suggested_action: ai.suggested_action || '',
            confidence: ai.confidence || 0,
            missing_information: ai.missing_information || [],
          },
        });
      }
    }
    console.log(`✔ ${db.publications.length} publicações migradas.`);
  }

  // 4. Opportunities
  if (Array.isArray(db.opportunities)) {
    for (const opp of db.opportunities) {
      // Verifica se o perfil associado existe
      const profileExists = await prisma.profile.findUnique({
        where: { id: opp.profileId },
      });

      if (!profileExists) {
        console.warn(`⚠️ Perfil '${opp.profileId}' não encontrado para a oportunidade '${opp.id}'. Ignorando.`);
        continue;
      }

      // Verifica se a publicação existe; se não existir, cria uma publicação placeholder
      const pubExists = await prisma.publication.findUnique({
        where: { id: opp.publicationId },
      });

      if (!pubExists) {
        console.warn(`⚠️ Publicação '${opp.publicationId}' não encontrada para a oportunidade '${opp.id}'. Criando registro sintético de suporte...`);
        await prisma.publication.create({
          data: {
            id: opp.publicationId,
            externalId: `synthetic_${opp.publicationId}`,
            username: opp.username || 'desconhecido',
            originalUrl: opp.originalUrl || '',
            mediaType: 'OTHER',
            caption: 'Publicação associada a oportunidade importada',
            publishedAt: opp.detectedAt ? new Date(opp.detectedAt) : new Date(),
            detectedAt: new Date(),
            analysisStatus: 'analyzed',
            relevance: opp.relevance || 'medium',
            isReviewed: true,
            isDemo: Boolean(opp.isDemo),
            profileId: opp.profileId,
          },
        });
      }

      await prisma.opportunity.upsert({
        where: { id: opp.id },
        update: {},
        create: {
          id: opp.id,
          profileId: opp.profileId,
          publicationId: opp.publicationId,
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
          detectedAt: opp.detectedAt ? new Date(opp.detectedAt) : new Date(),
          status: opp.status,
          internalNotes: opp.internalNotes || '',
          isDemo: Boolean(opp.isDemo),
          notified: Boolean(opp.notified),
          notifiedAt: opp.notifiedAt ? new Date(opp.notifiedAt) : null,
        },
      });

      if (Array.isArray(opp.contactLogs)) {
        for (const log of opp.contactLogs) {
          await prisma.contactLog.upsert({
            where: { id: log.id },
            update: {},
            create: {
              id: log.id,
              opportunityId: opp.id,
              date: new Date(log.date),
              responsible: log.responsible,
              channel: log.channel,
              notes: log.notes || '',
            },
          });
        }
      }
    }
    console.log(`✔ ${db.opportunities.length} oportunidades migradas.`);
  }

  // 5. System Logs
  if (Array.isArray(db.logs)) {
    for (const log of db.logs) {
      await prisma.systemLog.create({
        data: {
          id: log.id,
          timestamp: log.timestamp ? new Date(log.timestamp) : new Date(),
          level: log.level,
          module: log.module,
          message: log.message,
          metadata: log.metadata || undefined,
        },
      });
    }
    console.log(`✔ ${db.logs.length} logs migrados.`);
  }

  console.log('🎉 Migração para o PostgreSQL na Neon concluída com sucesso!');
}

main()
  .catch((e) => {
    console.error('❌ Erro durante a migração:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });