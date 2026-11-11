import { PrismaClient } from '@prisma/client';
import { aiAnalysisService } from './publicationAnalysisService';

const prisma = new PrismaClient();

export interface MetaMediaResponse {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url?: string;
  permalink: string;
  timestamp: string;
}

export class InstagramService {
  private static getCredentials() {
    const token = process.env.META_ACCESS_TOKEN;
    const instagramId = process.env.META_PAGE_ID;

    if (!token || !instagramId) {
      throw new Error('CONFIG_ERROR: META_ACCESS_TOKEN ou META_PAGE_ID não foram configurados no .env');
    }

    return { token, instagramId };
  }

  /**
   * Busca as mídias diretamente da Graph API da Meta
   */
  public static async fetchFromMeta(): Promise<MetaMediaResponse[]> {
    const { token, instagramId } = this.getCredentials();
    const fields = 'id,caption,media_type,media_url,permalink,timestamp';
    const url = `https://graph.facebook.com/v19.0/${instagramId}/media?fields=${fields}&access_token=${token}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new Error(`META_API_ERROR [${data.error.code}]: ${data.error.message}`);
    }

    return data.data || [];
  }
public static async syncPostsToDatabase() {
    const posts = await this.fetchFromMeta();

    // Garante que o perfil existe para vincular as publicações
    let profile = await prisma.profile.findUnique({ where: { username: 'vibzeventos' } });
    if (!profile) {
      profile = await prisma.profile.create({
        data: {
          username: 'vibzeventos',
          displayName: 'Vibz Eventos',
          profileUrl: 'https://instagram.com/vibzeventos',
          category: 'Casa de Show / Produtora',
          city: 'Vitória da Conquista',
          state: 'BA',
          monitoringStatus: 'active',
          integrationMethod: 'meta_api'
        }
      });
    }

    const syncPromises = posts.map(async (post) => {
      // 1. Salva ou atualiza na tabela bruta do Instagram
      const upsertedPost = await prisma.instagramPost.upsert({
        where: { id: post.id },
        update: {
          caption: post.caption || null,
          mediaType: post.media_type,
          mediaUrl: post.media_url || null,
          permalink: post.permalink,
          timestamp: new Date(post.timestamp),
        },
        create: {
          id: post.id,
          caption: post.caption || null,
          mediaType: post.media_type,
          mediaUrl: post.media_url || null,
          permalink: post.permalink,
          timestamp: new Date(post.timestamp),
        },
      });

      // 2. Garante que espelha também na tabela 'Publication' usada pelo Dashboard
      await prisma.publication.upsert({
        where: { externalId: post.id },
        update: {
          caption: post.caption || '',
          mediaUrl: post.media_url || null,
          originalUrl: post.permalink,
        },
        create: {
          externalId: post.id,
          username: profile.username,
          originalUrl: post.permalink,
          mediaType: post.media_type,
          caption: post.caption || '',
          publishedAt: new Date(post.timestamp),
          mediaUrl: post.media_url || null,
          analysisStatus: 'analyzed',
          relevance: 'none',
          profileId: profile.id,
        }
      });

      return upsertedPost;
    });

    const results = await Promise.all(syncPromises);
    return { syncedCount: results.length, posts: results };
  }

  /**
   * Retorna os posts armazenados no banco de dados local
   */
  public static async getStoredPosts(limit = 20) {
    return prisma.instagramPost.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  /**
   * Envia as legendas gravadas no banco de dados para análise da IA (Gemini)
   * e as insere nas tabelas do Dashboard (Profiles, Publications e Opportunities)
   */
  public static async analyzePendingPosts() {
    // 1. Garante que o perfil do Instagram existe no banco de dados para criar os relacionamentos
    let profile = await prisma.profile.findUnique({ where: { username: 'vibzeventos' } });
    
    if (!profile) {
      profile = await prisma.profile.create({
        data: {
          username: 'vibzeventos',
          displayName: 'Vibz Eventos',
          profileUrl: 'https://instagram.com/vibzeventos',
          category: 'Casa de Show / Produtora',
          city: 'Vitória da Conquista',
          state: 'BA',
          monitoringStatus: 'active',
          integrationMethod: 'meta_api'
        }
      });
      console.log('[InstagramService] Perfil @vibzeventos cadastrado automaticamente.');
    }

    // 2. Busca os últimos 15 posts brutos sincronizados
    const posts = await prisma.instagramPost.findMany({
      orderBy: { timestamp: 'desc' },
      take: 15,
    });

    let newOppsCount = 0;
    let newPubsCount = 0;

    for (const post of posts) {
      if (!post.caption) continue;

      // 3. Evita duplicidade verificando se a publicação já foi mapeada
      const existingPub = await prisma.publication.findUnique({ where: { externalId: post.id } });
      if (existingPub) continue;

      try {
        // 4. Salva a Publicação no Dashboard
        const newPub = await prisma.publication.create({
          data: {
            externalId: post.id,
            username: profile.username,
            originalUrl: post.permalink,
            mediaType: post.mediaType,
            caption: post.caption,
            publishedAt: post.timestamp,
            mediaUrl: post.mediaUrl,
            analysisStatus: 'analyzed',
            relevance: 'none',
            profileId: profile.id
          }
        });
        newPubsCount++;

        // 5. Analisa a legenda via Inteligência Artificial
        const analysis = await aiAnalysisService.analyzePublication({
          caption: post.caption,
          username: profile.username,
          category: profile.category,
          city: profile.city,
          publishedAt: post.timestamp.toISOString(),
        });

        // 6. Atualiza a Publicação com os resultados da IA
        await prisma.publication.update({
          where: { id: newPub.id },
          data: {
            relevance: analysis.relevance,
            aiAnalysis: {
              create: {
                is_event: analysis.is_event,
                is_opportunity: analysis.is_opportunity,
                category: analysis.category || 'Outros',
                relevance: analysis.relevance,
                event_name: analysis.event_name,
                event_date: analysis.event_date,
                event_time: analysis.event_time,
                venue: analysis.venue,
                city: analysis.city,
                state: analysis.state,
                artists: analysis.artists || [],
                summary: analysis.summary || 'Sem resumo',
                commercial_opportunity: analysis.commercial_opportunity || '',
                suggested_action: analysis.suggested_action || '',
                confidence: analysis.confidence || 0.8
              }
            }
          }
        });

        // 7. Se for uma Oportunidade viável, cadastra no CRM
        if (analysis.is_opportunity && (analysis.relevance === 'high' || analysis.relevance === 'medium')) {
          await prisma.opportunity.create({
            data: {
              profileId: profile.id,
              publicationId: newPub.id,
              username: profile.username,
              eventName: analysis.event_name || `Evento @${profile.username}`,
              category: analysis.category || 'Evento',
              eventDate: analysis.event_date,
              city: analysis.city || profile.city,
              venue: analysis.venue,
              artists: analysis.artists || [],
              summary: analysis.summary || '',
              originalUrl: post.permalink,
              relevance: analysis.relevance,
              commercialPotential: analysis.commercial_opportunity || '',
              suggestedAction: analysis.suggested_action || '',
              status: 'Nova'
            }
          });
          newOppsCount++;
        }
      } catch (err) {
        console.error(`[InstagramService] Falha ao analisar/salvar post ${post.id}:`, err);
      }
    }

    return { processed: newPubsCount, newOpportunities: newOppsCount };
  }
}