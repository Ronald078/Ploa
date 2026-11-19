'use strict';
// Synthetic examples based on observed structures; no contact data or live URLs.
const automaticos = {
  explicito: {
    'pt-BR': 'Eu sou um robô de autoatendimento. Para falar com um atendente, aguarde.',
    'pt-PT': 'Esta é uma mensagem automática do nosso atendimento.',
    'en-US': 'This is an automated reply from our customer service.',
    'es-ES': 'Este es un mensaje automático de atención al cliente.',
  },
  menu: {
    'pt-BR': 'Escolha uma opção:\n1️⃣ - Pedidos\n2️⃣ - Reservas',
    'pt-PT': 'Selecione 1 para marcações e 2 para informações.',
    'en-US': 'Press 1 for appointments or 2 for support.',
    'es-ES': 'Pulse 1 para citas o 2 para información.',
  },
  ausencia: {
    'pt-BR': 'Estamos temporariamente fechados para reformas.',
    'pt-PT': 'ESTAMOS ENCERRADOS TEMPORARIAMENTE.',
    'en-US': "We're away right now. Leave a message.",
    'es-ES': 'En este momento no podemos responder, pero lo haremos lo antes posible.',
  },
  fila: {
    'pt-BR': 'As mensagens serão respondidas por ordem de chegada.',
    'pt-PT': 'As mensagens são atendidas por ordem de chegada.',
    'en-US': 'Messages will be answered in the order received.',
    'es-ES': 'Los mensajes se responderán por orden de llegada.',
  },
  espera: {
    'pt-BR': 'Olá, seja bem-vindo! Só um instante, já iremos te atender.',
    'pt-PT': 'Obrigado por nos contactar! De momento não podemos atender, responderemos o mais rápido possível.',
    'en-US': 'Thank you for your message. We’re unavailable right now, but will respond as soon as possible.',
    'es-ES': 'Gracias por tu mensaje. En breve estaremos respondiendo para ayudarte con tu próxima cita.',
  },
  horarios: {
    'pt-BR': 'Nossos horários de atendimento: terça a sexta das 9h às 18h.',
    'pt-PT': 'Horário de funcionamento: segunda a sexta, das 9h às 18h.',
    'en-US': 'Opening hours: Monday to Friday, 9am to 6pm.',
    'es-ES': 'Horario de atención: lunes a viernes, de 9 a 18 horas.',
  },
  canal_alterado: {
    'pt-BR': 'Olá! Nosso número de atendimento mudou. Consulte o novo contacto.',
    'pt-PT': 'Este número foi desativado. Utilize o novo contacto.',
    'en-US': 'Our phone number has changed. Please use our new number.',
    'es-ES': 'Nuestro número ha cambiado. Utiliza el nuevo número.',
  },
  link_de_pedido_ou_marcacao: {
    'pt-BR': 'Agende seu horário pelo link: https://example.invalid/agenda',
    'pt-PT': 'Faça a sua marcação aqui: https://example.invalid/marcacoes',
    'en-US': 'Book your appointment online: https://example.invalid/book',
    'es-ES': 'Reserva tu cita aquí: https://example.invalid/citas',
  },
  saudacao_padrao_empresa: {
    'pt-BR': 'Loja Exemplo agradece seu contato. Como podemos ajudar?',
    'pt-PT': 'Obrigado por nos contactar! Estamos à sua disposição. Equipa Exemplo',
    'en-US': 'Thank you for contacting Example Shop! Please let us know how we can help you.',
    'es-ES': 'Gracias por comunicarte con Tienda Ejemplo. ¿Cómo podemos ayudarte?',
  },
  catalogo: {
    'pt-BR': 'Bem-vindo! Catálogo de peças prontas, cores e tamanhos: https://example.invalid/catalogo. Retirada na loja física.',
    'pt-PT': 'Bem-vindo! Catálogo e reservas disponíveis em https://example.invalid/catalogo. Consulte os horários.',
    'en-US': 'Welcome to our shop! Catalog and delivery information: https://example.invalid/catalog. Store address on the website.',
    'es-ES': 'Bienvenido. Catálogo, colores y tallas: https://example.invalid/catalogo. Recogida en tienda física.',
  },
};
const humanos = [
  'Boa noite, bem vindo a hostinger.', 'Seja bem-vindo! Como posso ajudar?',
  'Obrigado por nos contactar. Sou a Ana, em que posso ajudar?',
  'Welcome to our shop! How can I help?', 'Bienvenido. ¿Cómo puedo ayudarte?',
  'Thank you for contacting us. How can we help?', 'Gracias por contactar. ¿Qué necesitas?',
  'Já encaminhei sua mensagem para a equipe responsável.',
  'Vou passar sua proposta para a pessoa responsável. Um instante, por favor.',
  'Gostaria de um site com catálogo e disponibilidade, sem precisar confirmar tudo pelo WhatsApp.',
  'Minha ideia seria criar um site, com catálogo, agendamento e horários de atendimento.',
  'I want a website with a catalog and booking. Our business hours are 9am to 6pm.',
  'Gracias por tu propuesta. Necesito una web con catálogo y citas.',
  'Me chamo Ana e vou continuar seu atendimento. Por favor informe seu nome.',
  'Thank you for contacting Example Shop! My name is Ana. How can I help?',
  'Gracias por contactar con Tienda Ejemplo. Me llamo Ana, ¿cómo puedo ayudarte?',
  'Boa tarde. Não tenho interesse.', 'Não obrigado', 'No thanks', 'No me interesa',
  'Pode enviar uma proposta?', 'Quero conhecer melhor a ideia.', 'Só um momento.',
  'https://example.invalid', 'BEGIN:VCARD\nVERSION:3.0\nFN:Example\nEND:VCARD',
];
module.exports = { automaticos, humanos };
