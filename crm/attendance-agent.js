'use strict';

// One WhatsApp session serves both continuous attendance and on-demand outreach.
// The sender remains available as a standalone command outside the panel.
process.env.PLOA_CONTINUOUS_AGENT = '1';
require('../enviar_mensagens_whatsapp');
