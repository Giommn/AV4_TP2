import { randomUUID } from 'node:crypto';
import { Papel } from '../../domain/enums/papel.js';
import { Profissional } from '../../domain/entities/profissional.js';
import { VetorCompetencias } from '../../domain/value-objects/vetor-competencias.js';
import { Localizacao } from '../../domain/value-objects/localizacao.js';
import { IntervaloDatas } from '../../domain/value-objects/intervalo-datas.js';

export type MetadadosArquivo = Readonly<Record<string, string | number | boolean>>;

export interface AdaptadorArmazenamento {
  salvarArquivo(conteudo: Buffer, metadados?: MetadadosArquivo): Promise<string>;
  recuperarArquivo(id: string): Promise<Buffer>;
  listarArquivos(prefixo?: string): Promise<string[]>;
}

export interface AdaptadorPagamento {
  efetuarPagamento(valor: number, origem: string, destino: string): Promise<string>;
  cancelarPagamento(id: string): Promise<boolean>;
  verificarPagamento(id: string): Promise<string>;
}

export interface AdaptadorProfissional {
  listarProfissionais(criterios?: { papel?: Papel }): Promise<Profissional[]>;
  detalharProfissional(id: string): Promise<Profissional>;
  registrarAvaliacao(id: string, avaliacao: number): Promise<void>;
}

// APIs de demonstração com formatos intencionalmente diferentes dos contratos do núcleo.
export class ApiS3Simulada {
  private readonly objetos = new Map<string, Buffer>();
  async putObject(input: { Bucket: string; Key: string; Body: Buffer }): Promise<{ Location: string }> {
    const key = `${input.Bucket}/${input.Key}`;
    this.objetos.set(key, Buffer.from(input.Body));
    return { Location: `s3://${key}` };
  }
  async getObject(location: string): Promise<{ Body: Buffer }> {
    const body = this.objetos.get(location.replace(/^s3:\/\//, ''));
    if (!body) throw new Error(`Objeto S3 não encontrado: ${location}`);
    return { Body: Buffer.from(body) };
  }
  async listObjects(prefix: string): Promise<{ Contents: { Key: string }[] }> {
    return { Contents: [...this.objetos.keys()].filter((key) => key.startsWith(prefix)).map((Key) => ({ Key })) };
  }
}

export class ApiGoogleCloudSimulada {
  private readonly objetos = new Map<string, Buffer>();
  async save(bucket: string, name: string, bytes: Buffer): Promise<{ name: string; bucket: string }> {
    this.objetos.set(`${bucket}/${name}`, Buffer.from(bytes));
    return { name, bucket };
  }
  async download(uri: string): Promise<Buffer> {
    const body = this.objetos.get(uri.replace(/^gs:\/\//, ''));
    if (!body) throw new Error(`Objeto Google Cloud não encontrado: ${uri}`);
    return Buffer.from(body);
  }
  async files(bucket: string, prefix: string): Promise<string[]> {
    return [...this.objetos.keys()].filter((key) => key.startsWith(`${bucket}/${prefix}`)).map((key) => `gs://${key}`);
  }
}

export class AdaptadorS3 implements AdaptadorArmazenamento {
  constructor(private readonly api = new ApiS3Simulada(), private readonly bucket = 'cinebridge') {}
  async salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo = {}): Promise<string> {
    const nome = String(metadados.nome ?? randomUUID());
    return (await this.api.putObject({ Bucket: this.bucket, Key: nome, Body: conteudo })).Location;
  }
  async recuperarArquivo(id: string): Promise<Buffer> { return (await this.api.getObject(id)).Body; }
  async listarArquivos(prefixo = ''): Promise<string[]> {
    return (await this.api.listObjects(`${this.bucket}/${prefixo}`)).Contents.map(({ Key }) => `s3://${Key}`);
  }
}

export class AdaptadorGoogleCloud implements AdaptadorArmazenamento {
  constructor(private readonly api = new ApiGoogleCloudSimulada(), private readonly bucket = 'cinebridge') {}
  async salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo = {}): Promise<string> {
    const nome = String(metadados.nome ?? randomUUID());
    const salvo = await this.api.save(this.bucket, nome, conteudo);
    return `gs://${salvo.bucket}/${salvo.name}`;
  }
  recuperarArquivo(id: string): Promise<Buffer> { return this.api.download(id); }
  listarArquivos(prefixo = ''): Promise<string[]> { return this.api.files(this.bucket, prefixo); }
}

/** Armazenamento local simulado para desenvolvimento offline e para o provedor do diagrama. */
export class AdaptadorLocal implements AdaptadorArmazenamento {
  private readonly arquivos = new Map<string, Buffer>();
  async salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo = {}): Promise<string> {
    const id = `local://${String(metadados.nome ?? randomUUID())}`;
    this.arquivos.set(id, Buffer.from(conteudo));
    return id;
  }
  async recuperarArquivo(id: string): Promise<Buffer> {
    const arquivo = this.arquivos.get(id);
    if (!arquivo) throw new Error(`Arquivo local não encontrado: ${id}`);
    return Buffer.from(arquivo);
  }
  async listarArquivos(prefixo = ''): Promise<string[]> {
    return [...this.arquivos.keys()].filter((id) => id.startsWith(`local://${prefixo}`));
  }
}

export class ApiStripeSimulada {
  private readonly pagamentos = new Map<string, string>();
  async createCharge(input: { amount: number; source: string; destination: string }): Promise<{ id: string }> {
    const id = `ch_${randomUUID()}`;
    this.pagamentos.set(id, `paid:${input.amount}:${input.source}:${input.destination}`);
    return { id };
  }
  async refund(id: string): Promise<{ status: 'refunded' | 'missing' }> {
    if (!this.pagamentos.has(id)) return { status: 'missing' };
    this.pagamentos.set(id, 'refunded');
    return { status: 'refunded' };
  }
  async retrieve(id: string): Promise<{ paid: boolean; refunded: boolean }> {
    const value = this.pagamentos.get(id);
    if (!value) throw new Error(`Cobrança Stripe não encontrada: ${id}`);
    return { paid: value !== 'refunded', refunded: value === 'refunded' };
  }
}

export class ApiPagSeguroSimulada {
  private readonly pagamentos = new Map<string, 'AUTHORIZED' | 'CANCELED'>();
  async createOrder(payload: { amount: number; payer: string; receiver: string }): Promise<{ reference: string; status: string }> {
    const reference = `ps_${randomUUID()}`;
    this.pagamentos.set(reference, 'AUTHORIZED');
    void payload;
    return { reference, status: 'AUTHORIZED' };
  }
  async cancelOrder(reference: string): Promise<{ canceled: boolean }> {
    if (!this.pagamentos.has(reference)) return { canceled: false };
    this.pagamentos.set(reference, 'CANCELED');
    return { canceled: true };
  }
  async getOrder(reference: string): Promise<{ status: string }> {
    const status = this.pagamentos.get(reference);
    if (!status) throw new Error(`Pedido PagSeguro não encontrado: ${reference}`);
    return { status };
  }
}

export class ApiPayPalSimulada {
  private readonly pagamentos = new Map<string, 'COMPLETED' | 'VOIDED'>();
  async create(input: { total: string; payerId: string; payeeId: string }): Promise<{ paymentToken: string; state: string }> {
    const paymentToken = `pp_${randomUUID()}`;
    this.pagamentos.set(paymentToken, 'COMPLETED');
    void input;
    return { paymentToken, state: 'COMPLETED' };
  }
  async void(paymentToken: string): Promise<{ success: boolean }> {
    if (!this.pagamentos.has(paymentToken)) return { success: false };
    this.pagamentos.set(paymentToken, 'VOIDED');
    return { success: true };
  }
  async inspect(paymentToken: string): Promise<{ state: string }> {
    const state = this.pagamentos.get(paymentToken);
    if (!state) throw new Error(`Pagamento PayPal não encontrado: ${paymentToken}`);
    return { state };
  }
}

export class AdaptadorStripe implements AdaptadorPagamento {
  constructor(private readonly api = new ApiStripeSimulada()) {}
  async efetuarPagamento(valor: number, origem: string, destino: string): Promise<string> {
    this.validarValor(valor);
    return (await this.api.createCharge({ amount: Math.round(valor * 100), source: origem, destination: destino })).id;
  }
  async cancelarPagamento(id: string): Promise<boolean> { return (await this.api.refund(id)).status === 'refunded'; }
  async verificarPagamento(id: string): Promise<string> {
    const status = await this.api.retrieve(id);
    return status.refunded ? 'cancelado' : status.paid ? 'aprovado' : 'pendente';
  }
  private validarValor(valor: number): void { if (!Number.isFinite(valor) || valor <= 0) throw new Error('O valor do pagamento deve ser positivo'); }
}

export class AdaptadorPagSeguro implements AdaptadorPagamento {
  constructor(private readonly api = new ApiPagSeguroSimulada()) {}
  async efetuarPagamento(valor: number, origem: string, destino: string): Promise<string> {
    if (!Number.isFinite(valor) || valor <= 0) throw new Error('O valor do pagamento deve ser positivo');
    return (await this.api.createOrder({ amount: valor, payer: origem, receiver: destino })).reference;
  }
  async cancelarPagamento(id: string): Promise<boolean> { return (await this.api.cancelOrder(id)).canceled; }
  async verificarPagamento(id: string): Promise<string> {
    const status = (await this.api.getOrder(id)).status;
    return status === 'AUTHORIZED' ? 'aprovado' : status === 'CANCELED' ? 'cancelado' : 'pendente';
  }
}

export class AdaptadorPayPal implements AdaptadorPagamento {
  constructor(private readonly api = new ApiPayPalSimulada()) {}
  async efetuarPagamento(valor: number, origem: string, destino: string): Promise<string> {
    if (!Number.isFinite(valor) || valor <= 0) throw new Error('O valor do pagamento deve ser positivo');
    return (await this.api.create({ total: valor.toFixed(2), payerId: origem, payeeId: destino })).paymentToken;
  }
  async cancelarPagamento(id: string): Promise<boolean> { return (await this.api.void(id)).success; }
  async verificarPagamento(id: string): Promise<string> {
    const state = (await this.api.inspect(id)).state;
    return state === 'COMPLETED' ? 'aprovado' : state === 'VOIDED' ? 'cancelado' : 'pendente';
  }
}

export interface RegistroProfissionalExterno {
  id: string; displayName: string; roles: string[]; skills?: Record<string, number>;
  hourlyRate?: number; city?: string; state?: string; country?: string;
}

export class ApiLinkedInSimulada {
  constructor(private readonly perfis: readonly RegistroProfissionalExterno[] = []) {}
  async search(filters: { role?: string }): Promise<{ elements: readonly RegistroProfissionalExterno[] }> {
    return { elements: this.perfis.filter((perfil) => !filters.role || perfil.roles.includes(filters.role)) };
  }
  async getProfile(id: string): Promise<{ profile?: RegistroProfissionalExterno }> {
    return { profile: this.perfis.find((perfil) => perfil.id === id) };
  }
  async endorse(id: string, _rating: number): Promise<{ accepted: boolean }> {
    return { accepted: this.perfis.some((perfil) => perfil.id === id) };
  }
}

export class ApiProfissionalInternaSimulada extends ApiLinkedInSimulada {
  async query(filters: { role?: string }): Promise<{ records: readonly RegistroProfissionalExterno[] }> {
    const results = await this.search(filters);
    return { records: results.elements };
  }
}

abstract class AdaptadorProfissionalBase implements AdaptadorProfissional {
  protected constructor(protected readonly agora: () => Date = () => new Date()) {}
  protected mapear(registro: RegistroProfissionalExterno): Profissional {
    const papeis = registro.roles.map((nome) => Object.values(Papel).find((papel) => papel === nome || papel.toLowerCase() === nome.toLowerCase())).filter((papel): papel is Papel => papel !== undefined);
    const fim = this.agora();
    fim.setFullYear(fim.getFullYear() + 5);
    const inicio = new Date(fim.getTime());
    inicio.setFullYear(inicio.getFullYear() - 15);
    const preco = registro.hourlyRate ?? 100;
    return new Profissional({
      id: registro.id, nome: registro.displayName, papeis,
      competencias: registro.skills ? VetorCompetencias.criar(registro.skills) : VetorCompetencias.vazio(),
      precoMinimo: preco, precoMaximo: preco, disponibilidade: [new IntervaloDatas(inicio, fim)],
      localizacao: new Localizacao(registro.city ?? 'Remoto', registro.state ?? 'NA', registro.country ?? 'Brasil'),
      mediaAvaliacoes: 0, totalAvaliacoes: 0, afinidades: {},
    });
  }
  abstract listarProfissionais(criterios?: { papel?: Papel }): Promise<Profissional[]>;
  abstract detalharProfissional(id: string): Promise<Profissional>;
  abstract registrarAvaliacao(id: string, avaliacao: number): Promise<void>;
}

export class AdaptadorLinkedIn extends AdaptadorProfissionalBase {
  constructor(private readonly api = new ApiLinkedInSimulada(), agora?: () => Date) { super(agora); }
  async listarProfissionais(criterios: { papel?: Papel } = {}): Promise<Profissional[]> {
    return (await this.api.search({ role: criterios.papel })).elements.map((registro) => this.mapear(registro));
  }
  async detalharProfissional(id: string): Promise<Profissional> {
    const registro = (await this.api.getProfile(id)).profile;
    if (!registro) throw new Error(`Profissional não encontrado: ${id}`);
    return this.mapear(registro);
  }
  async registrarAvaliacao(id: string, avaliacao: number): Promise<void> {
    if (avaliacao < 0 || avaliacao > 5) throw new Error('Avaliação deve estar entre 0 e 5');
    if (!(await this.api.endorse(id, avaliacao)).accepted) throw new Error(`Profissional não encontrado: ${id}`);
  }
}

export class AdaptadorInterno extends AdaptadorProfissionalBase {
  constructor(private readonly api = new ApiProfissionalInternaSimulada(), agora?: () => Date) { super(agora); }
  async listarProfissionais(criterios: { papel?: Papel } = {}): Promise<Profissional[]> {
    return (await this.api.query({ role: criterios.papel })).records.map((registro) => this.mapear(registro));
  }
  async detalharProfissional(id: string): Promise<Profissional> {
    const perfil = (await this.api.getProfile(id)).profile;
    if (!perfil) throw new Error(`Profissional não encontrado: ${id}`);
    return this.mapear(perfil);
  }
  async registrarAvaliacao(id: string, avaliacao: number): Promise<void> {
    if (avaliacao < 0 || avaliacao > 5) throw new Error('Avaliação deve estar entre 0 e 5');
    if (!(await this.api.endorse(id, avaliacao)).accepted) throw new Error(`Profissional não encontrado: ${id}`);
  }
}

export interface RegistroIndeed {
  candidateId: string;
  fullName: string;
  specialties: string[];
  skillVector?: Record<string, number>;
  expectedRate?: number;
  location?: { city: string; region: string; country: string };
}

/** API de vagas simulada, com nomes de campos diferentes dos registros do LinkedIn. */
export class ApiIndeedSimulada {
  constructor(private readonly registros: readonly RegistroIndeed[] = []) {}
  async findCandidates(filter: { specialty?: string }): Promise<{ matches: readonly RegistroIndeed[] }> {
    return { matches: this.registros.filter((registro) => !filter.specialty || registro.specialties.includes(filter.specialty)) };
  }
  async candidate(candidateId: string): Promise<{ result?: RegistroIndeed }> {
    return { result: this.registros.find((registro) => registro.candidateId === candidateId) };
  }
  async addRating(candidateId: string, _rating: number): Promise<{ updated: boolean }> {
    return { updated: this.registros.some((registro) => registro.candidateId === candidateId) };
  }
}

export class AdaptadorIndeed extends AdaptadorProfissionalBase {
  constructor(private readonly api = new ApiIndeedSimulada(), agora?: () => Date) { super(agora); }
  async listarProfissionais(criterios: { papel?: Papel } = {}): Promise<Profissional[]> {
    const { matches } = await this.api.findCandidates({ specialty: criterios.papel });
    return matches.map((match) => this.mapear(this.converter(match)));
  }
  async detalharProfissional(id: string): Promise<Profissional> {
    const perfil = (await this.api.candidate(id)).result;
    if (!perfil) throw new Error(`Profissional não encontrado: ${id}`);
    return this.mapear(this.converter(perfil));
  }
  async registrarAvaliacao(id: string, avaliacao: number): Promise<void> {
    if (avaliacao < 0 || avaliacao > 5) throw new Error('Avaliação deve estar entre 0 e 5');
    if (!(await this.api.addRating(id, avaliacao)).updated) throw new Error(`Profissional não encontrado: ${id}`);
  }
  private converter(registro: RegistroIndeed): RegistroProfissionalExterno {
    return {
      id: registro.candidateId,
      displayName: registro.fullName,
      roles: registro.specialties,
      skills: registro.skillVector,
      hourlyRate: registro.expectedRate,
      city: registro.location?.city,
      state: registro.location?.region,
      country: registro.location?.country,
    };
  }
}
