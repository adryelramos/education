import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

export const adminRouter = Router();

adminRouter.post('/admin/clear-data', async (_req, res) => {
  try {
    const deletedCount = await prisma.dadosEducacao.deleteMany({});
    return res.json({
      success: true,
      message: 'Todos os dados foram deletados com sucesso.',
      registros_deletados: deletedCount.count
    });
  } catch (error) {
    console.error('Erro ao deletar dados:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro ao deletar dados do banco.'
    });
  }
});
