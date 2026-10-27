// products.js — إدارة المنتجات داخل لوحة التحكم
(function () {
  let productsCache = [];
  let editingProductIndex = null;

  function $(id) { return document.getElementById(id); }

  // حد Firestore الأقصى لكل حقل هو 1,048,487 بايت — نبقى تحته بهامش آمن
  const MAX_IMG_BYTES = 900000;

  function getProducts() {
    return productsCache;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('تعذر قراءة الصورة'));
      img.src = url;
    });
  }

  function drawToDataURL(img, maxDim, quality) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  }

  // تصغير/ضغط الصورة قبل التخزين حتى لا تتجاوز حد Firestore
  async function compressImage(file) {
    const url = URL.createObjectURL(file);
    let img;
    try {
      img = await loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const dims = [1200, 1000, 800, 600, 400];
    const quals = [0.85, 0.75, 0.65, 0.55];
    let data = '';
    for (const d of dims) {
      for (const q of quals) {
        data = drawToDataURL(img, d, q);
        if (data.length <= MAX_IMG_BYTES) return data;
      }
    }
    return data;
  }

  async function persistProducts(products) {
    productsCache = products;
    if (typeof window.storeSaveProducts === 'function') {
      const ok = await window.storeSaveProducts(products);
      if (!ok) localStorage.setItem('allProducts', JSON.stringify(products));
      return ok;
    }
    localStorage.setItem('allProducts', JSON.stringify(products));
    return false;
  }

  function showSuccess(msg) {
    const el = $('pform-success');
    el.textContent = '✓ ' + msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
  }

  function showError(msg) {
    const el = $('pform-error');
    el.textContent = '✗ ' + msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
  }

  function resetForm() {
    $('product-form').reset();
    $('product-image-preview').classList.add('hidden');
    $('pform-title').textContent = 'إضافة منتج جديد';
    $('product-submit').textContent = 'حفظ المنتج';
    $('product-submit').classList.remove('bg-amber-600', 'hover:bg-amber-700');
    $('product-submit').classList.add('bg-emerald-600', 'hover:bg-emerald-700');
    $('product-cancel').classList.add('hidden');
    editingProductIndex = null;
  }

  function displayProducts() {
    const products = getProducts();
    const grid = $('products-grid');
    $('product-count').textContent = products.length;

    if (products.length === 0) {
      grid.innerHTML = '<tr><td colspan="5" class="text-center py-10 text-slate-500">لا توجد منتجات</td></tr>';
      return;
    }

    grid.innerHTML = products.map((product, index) => `
      <tr class="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
        <td class="px-4 py-3">
          <div class="w-12 h-12 bg-slate-800 rounded-lg overflow-hidden flex-shrink-0">
            <img src="${product.img}" alt="${product.name}" class="w-full h-full object-cover">
          </div>
        </td>
        <td class="px-4 py-3">
          <span class="font-bold text-white text-sm">${product.name}</span>
        </td>
        <td class="px-4 py-3">
          <span class="text-slate-400 text-sm line-clamp-1">${product.desc}</span>
        </td>
        <td class="px-4 py-3">
          <span class="font-extrabold text-emerald-400 text-sm whitespace-nowrap">${product.price} د.ك</span>
        </td>
        <td class="px-4 py-3">
          <div class="flex items-center gap-2 justify-center">
            <button class="px-2 py-1.5 rounded-md text-xs font-bold bg-slate-700/70 text-slate-200 border border-slate-600 hover:bg-slate-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" onclick="window.adminProducts.move(${index}, -1)" ${index === 0 ? 'disabled' : ''} title="تحريك للأعلى">↑</button>
            <button class="px-2 py-1.5 rounded-md text-xs font-bold bg-slate-700/70 text-slate-200 border border-slate-600 hover:bg-slate-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" onclick="window.adminProducts.move(${index}, 1)" ${index === products.length - 1 ? 'disabled' : ''} title="تحريك للأسفل">↓</button>
            <button class="px-3 py-1.5 rounded-md text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600 hover:text-white transition-colors" onclick="window.adminProducts.edit(${index})">✏️ تعديل</button>
            <button class="px-3 py-1.5 rounded-md text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-600 hover:text-white transition-colors" onclick="window.adminProducts.remove(${index})">🗑️ حذف</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function editProduct(index) {
    const products = getProducts();
    const product = products[index];
    editingProductIndex = index;
    $('product-name').value = product.name;
    $('product-desc').value = product.desc;
    $('product-price').value = product.price;
    $('product-preview-img').src = product.img;
    $('product-image-preview').classList.remove('hidden');
    $('pform-title').textContent = 'تعديل المنتج';
    $('product-submit').textContent = 'تحديث المنتج';
    $('product-submit').classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
    $('product-submit').classList.add('bg-amber-600', 'hover:bg-amber-700');
    $('product-cancel').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteProduct(index) {
    const products = getProducts();
    const product = products[index];
    if (confirm(`هل تريد حذف "${product.name}"؟`)) {
      products.splice(index, 1);
      const ok = await persistProducts(products);
      if (!ok) { showError('تم الحذف محليًا فقط — فشل الحفظ في قاعدة البيانات'); }
      else { showSuccess('تم حذف المنتج بنجاح'); }
      displayProducts();
    }
  }

  async function moveProduct(index, direction) {
    const products = getProducts();
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= products.length) return;
    [products[index], products[targetIndex]] = [products[targetIndex], products[index]];
    const ok = await persistProducts(products);
    displayProducts();
    if (!ok) { showError('تم الترتيب محليًا فقط — فشل الحفظ في قاعدة البيانات'); }
    else { showSuccess('تم حفظ ترتيب المنتجات'); }
  }

  async function saveProduct(event) {
    event.preventDefault();
    const name = $('product-name').value.trim();
    const desc = $('product-desc').value.trim();
    const price = parseFloat($('product-price').value).toFixed(3);
    const fileInput = $('product-image');

    if (!name || !desc || !price) { showError('يرجى ملء جميع الحقول'); return; }

    // تعديل بدون صورة جديدة — نحتفظ بالصورة القديمة
    if (!fileInput.files[0] && editingProductIndex !== null) {
      const products = getProducts();
      const newProduct = { name, desc, price, img: products[editingProductIndex].img };
      if (products[editingProductIndex]._id) newProduct._id = products[editingProductIndex]._id;
      products[editingProductIndex] = newProduct;
      const ok = await persistProducts(products);
      resetForm();
      displayProducts();
      if (!ok) { showError('تم التعديل محليًا فقط — فشل الحفظ في قاعدة البيانات'); }
      else { showSuccess('تم تحديث المنتج بنجاح'); }
      return;
    }

    if (!fileInput.files[0] && editingProductIndex === null) {
      showError('يرجى إضافة صورة للمنتج');
      return;
    }

    let imgData;
    try {
      imgData = await compressImage(fileInput.files[0]);
    } catch (err) {
      showError('تعذر معالجة الصورة، جرّب صورة أخرى');
      return;
    }

    const newProduct = { name, desc, price, img: imgData };
    const products = getProducts();
    const wasEditing = editingProductIndex !== null;
    if (wasEditing) {
      if (products[editingProductIndex]._id) newProduct._id = products[editingProductIndex]._id;
      products[editingProductIndex] = newProduct;
    } else {
      products.unshift(newProduct);
    }
    const ok = await persistProducts(products);
    resetForm();
    displayProducts();
    if (!ok) {
      showError('تم الحفظ محليًا فقط — فشل الحفظ في قاعدة البيانات');
    } else if (wasEditing) {
      showSuccess('تم تحديث المنتج بنجاح');
    } else {
      showSuccess('تم إضافة المنتج بنجاح');
    }
  }

  // ── التهيئة ──────────────────────────────────────────────
  function init() {
    // معاينة الصورة
    $('product-image').addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function (ev) {
          $('product-preview-img').src = ev.target.result;
          $('product-image-preview').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
      }
    });

    $('product-form').addEventListener('submit', saveProduct);
    $('product-cancel').addEventListener('click', resetForm);

    // تحميل المنتجات من Firestore (المصدر الوحيد) — لا زرع لمنتجات قديمة
    (async function () {
      if (typeof window.storeGetProducts === 'function') {
        productsCache = (await window.storeGetProducts()) || [];
      }
      displayProducts();
      if (typeof window.storeWatchProducts === 'function') {
        window.storeWatchProducts(function (items) {
          productsCache = items || [];
          displayProducts();
        });
      }
    })();
  }

  // واجهة عامة لأزرار التعديل/الحذف
  window.adminProducts = { edit: editProduct, remove: deleteProduct, move: moveProduct };

  // التهيئة عند جاهزية DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
