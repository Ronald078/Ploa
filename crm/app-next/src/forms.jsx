import React from 'react';
import {Select} from './Select.jsx';
import {rememberAction} from './action-origin.js';
export function Field({ label, value = '', onChange, type = 'text', options, ...props }) {
  if(options)return <div className="next-field"><span>{label}</span><Select label={label} value={value} onChange={onChange} options={options} {...props}/></div>;
  return <label className="next-field"><span>{label}</span>{type === 'textarea' ? <textarea aria-label={label} value={value} onChange={event => onChange(event.target.value)} {...props} /> : <input aria-label={label} type={type} value={value} onChange={event => onChange(event.target.value)} {...props} />}</label>;
}
export const Button = ({ children, primary, className='', onClickCapture, ...props }) => <button type="button" className={'button ' + (primary ? 'button-primary' : 'button-secondary')+' '+className} {...props} onClickCapture={event=>{rememberAction(event.currentTarget);onClickCapture?.(event);}}>{children}</button>;
export function Details({ title, children,defaultOpen=false }) { return <details className="panel next-details" open={defaultOpen||undefined}><summary>{title}</summary><div className="next-details-content">{children}</div></details>; }
