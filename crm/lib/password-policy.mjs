export const PASSWORD_RULE='Use pelo menos 8 caracteres, com no mínimo 1 letra maiúscula, 1 número e 1 caractere especial. Pode usar mais de um de cada.';
export const PASSWORD_PATTERN='(?=.*\\p{Lu})(?=.*[0-9])(?=.*[\\p{P}\\p{S}]).{8,}';
const valid=new RegExp('^(?:'+PASSWORD_PATTERN+')$','u');
export function passwordProblem(value){
 return typeof value==='string'&&value.length<=1024&&valid.test(value)?'':PASSWORD_RULE;
}
