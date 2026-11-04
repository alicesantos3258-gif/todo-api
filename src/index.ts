import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ status: "online", service: "todo-api" });
});

// ===== EMPRESAS =====

app.post("/empresas", async (req, res) => {
  try {
    const empresa = await prisma.empresa.create({ data: req.body });
    res.status(201).json(empresa);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/empresas", async (req, res) => {
  const empresas = await prisma.empresa.findMany({
    orderBy: { createdAt: "desc" },
  });
  res.json(empresas);
});

app.get("/empresas/:id", async (req, res) => {
  const empresa = await prisma.empresa.findUnique({
    where: { id: req.params.id },
    include: { calculosMargem: true },
  });
  if (!empresa) return res.status(404).json({ error: "Empresa não encontrada" });
  res.json(empresa);
});

// ===== CÁLCULO DE MARGEM DE LUCRO =====

interface EntradaCalculo {
  faturamentoMensal: number;
  impostosVendas: number;
  outrasReceitas?: number;
  custosDiretos: number;
  folhaPagamento: number;
  encargosTrabalhistas: number;
  aluguel?: number;
  energia?: number;
  agua?: number;
  internet?: number;
  despesasAdmin?: number;
  taxasCartao?: number;
  plataformas?: number;
  outrasDespesas?: number;
  proLabore?: number;
  parcelamentosTrib?: number;
  outrasDividas?: number;
  percentualReserva?: number;
}

function calcularMargemLucro(d: EntradaCalculo) {
  const despesasFixas =
    d.folhaPagamento + d.encargosTrabalhistas + (d.aluguel ?? 0) +
    (d.energia ?? 0) + (d.agua ?? 0) + (d.internet ?? 0) +
    (d.despesasAdmin ?? 0) + (d.taxasCartao ?? 0) +
    (d.plataformas ?? 0) + (d.outrasDespesas ?? 0);

  const receitaLiquida = d.faturamentoMensal - d.impostosVendas + (d.outrasReceitas ?? 0);
  const margemContribuicao = receitaLiquida - d.custosDiretos;
  const resultadoOperacional = margemContribuicao - despesasFixas;
  const resultadoAposRetiradas =
    resultadoOperacional - (d.proLabore ?? 0) - (d.parcelamentosTrib ?? 0) - (d.outrasDividas ?? 0);
  const sobraDisponivel = resultadoAposRetiradas;

  const percentualReserva = d.percentualReserva ?? 0;
  const valorReserva = sobraDisponivel > 0 ? sobraDisponivel * (percentualReserva / 100) : 0;
  const lucroDisponivel = sobraDisponivel - valorReserva;

  const margemLucroOperacional = receitaLiquida > 0 ? (resultadoOperacional / receitaLiquida) * 100 : 0;
  const percentualCustosDiretos = receitaLiquida > 0 ? (d.custosDiretos / receitaLiquida) * 100 : 0;
  const percentualDespesasFixas = receitaLiquida > 0 ? (despesasFixas / receitaLiquida) * 100 : 0;
  const percentualCustoFolha = receitaLiquida > 0
    ? ((d.custosDiretos + d.folhaPagamento + d.encargosTrabalhistas) / receitaLiquida) * 100
    : 0;

  let semaforoMargem: "verde" | "amarelo" | "vermelho";
  if (margemLucroOperacional >= 20) semaforoMargem = "verde";
  else if (margemLucroOperacional >= 10) semaforoMargem = "amarelo";
  else semaforoMargem = "vermelho";

  let semaforoCustoFolha: "verde" | "amarelo" | "vermelho";
  if (percentualCustoFolha <= 60) semaforoCustoFolha = "verde";
  else if (percentualCustoFolha <= 65) semaforoCustoFolha = "amarelo";
  else semaforoCustoFolha = "vermelho";

  let mensagemDiagnostico: string;
  if (semaforoMargem === "verde" && semaforoCustoFolha === "verde") {
    mensagemDiagnostico = `Situação financeira saudável. Margem de ${margemLucroOperacional.toFixed(1)}% e custos sob controle.`;
  } else if (semaforoMargem === "vermelho") {
    mensagemDiagnostico = `Alerta crítico: margem de ${margemLucroOperacional.toFixed(1)}%, abaixo do mínimo saudável.`;
  } else if (semaforoCustoFolha === "vermelho") {
    mensagemDiagnostico = `Atenção: custos diretos e folha consomem ${percentualCustoFolha.toFixed(1)}% da receita líquida.`;
  } else {
    mensagemDiagnostico = `Situação de alerta moderado. Margem em ${margemLucroOperacional.toFixed(1)}%.`;
  }

  return {
    receitaLiquida, margemContribuicao, resultadoOperacional, resultadoAposRetiradas,
    sobraDisponivel, valorReserva, lucroDisponivel, margemLucroOperacional,
    percentualCustosDiretos, percentualDespesasFixas, percentualCustoFolha,
    semaforoMargem, semaforoCustoFolha, mensagemDiagnostico,
  };
}

app.post("/empresas/:empresaId/calculos", async (req, res) => {
  try {
    const { empresaId } = req.params;
    const dados: EntradaCalculo & { competencia: string } = req.body;

    const resultado = calcularMargemLucro(dados);

    const calculo = await prisma.calculoMargem.create({
      data: {
        empresaId,
        competencia: new Date(dados.competencia),
        faturamentoMensal: dados.faturamentoMensal,
        impostosVendas: dados.impostosVendas,
        outrasReceitas: dados.outrasReceitas ?? 0,
        custosDiretos: dados.custosDiretos,
        folhaPagamento: dados.folhaPagamento,
        encargosTrabalhistas: dados.encargosTrabalhistas,
        aluguel: dados.aluguel ?? 0,
        energia: dados.energia ?? 0,
        agua: dados.agua ?? 0,
        internet: dados.internet ?? 0,
        despesasAdmin: dados.despesasAdmin ?? 0,
        taxasCartao: dados.taxasCartao ?? 0,
        plataformas: dados.plataformas ?? 0,
        outrasDespesas: dados.outrasDespesas ?? 0,
        proLabore: dados.proLabore ?? 0,
        parcelamentosTrib: dados.parcelamentosTrib ?? 0,
        outrasDividas: dados.outrasDividas ?? 0,
        percentualReserva: dados.percentualReserva ?? 0,
      },
    });

    res.status(201).json({ calculo, resultado });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/empresas/:empresaId/calculos", async (req, res) => {
  const calculos = await prisma.calculoMargem.findMany({
    where: { empresaId: req.params.empresaId },
    orderBy: { competencia: "desc" },
  });
  res.json(calculos);
});

app.listen(PORT, () => {
  console.log(`todo-api rodando na porta ${PORT}`);
});
