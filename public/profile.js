const login=document.querySelector('#profileLogin'),input=document.querySelector('#nickColor'),preview=document.querySelector('#colorPreview'),message=document.querySelector('#message');
let currentColor='#91a6ff';
const validColor=value=>/^#[0-9a-f]{6}$/i.test(value);
function updatePreview(){const color=input.value.trim();if(validColor(color)){currentColor=color;preview.style.setProperty('--nick-color',color);login.style.color=color;input.setCustomValidity('')}else input.setCustomValidity('Введите HEX-цвет в формате #RRGGBB')}
input.addEventListener('input',updatePreview);
(async()=>{let response=await fetch('/api/auth/me');if(!response.ok)return location='/login';let user=(await response.json()).user;currentColor=user.nickColor||currentColor;input.value=currentColor;login.textContent=user.login;updatePreview()})();
document.querySelector('#save').onclick=async()=>{updatePreview();if(!input.reportValidity())return;let response=await fetch('/api/auth/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickColor:currentColor})}),data=await response.json();if(!response.ok){message.textContent=data.error;return}currentColor=data.user.nickColor;input.value=currentColor;updatePreview();message.textContent='Цвет сохранён'};
document.querySelector('#logout').onclick=async()=>{await fetch('/api/auth/logout',{method:'POST'});location='/login'};
