require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Conectado a MongoDB Atlas (La Taverna - Simplificada)'))
    .catch(err => {
        console.error('❌ Error conectando a MongoDB:', err.message);
    });

// Modelo de Plato con soporte para Alérgenos
const Plato = mongoose.model('Plato', new mongoose.Schema({ 
    nombre: String, 
    descripcion: String, 
    precio: Number, 
    imagen: String, 
    categoria: { type: String, default: 'Otros' }, 
    oculto: { type: Boolean, default: false },
    alergenos: { type: [String], default: [] } 
}));

function verificarToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: true, mensaje: "No autorizado." });
    jwt.verify(token.split(" ")[1], process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: true, mensaje: "Sesión caducada." });
        req.usuario = decoded; next();
    });
}

// LOGIN
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ rol: "gerente" }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ error: false, token });
    } else res.status(401).json({ error: true, mensaje: "Contraseña incorrecta." });
});

// CARTA (Pública)
app.get('/api/carta', async (req, res) => res.json(await Plato.find()));

// GESTIÓN DE CARTA (Privada)
app.post('/api/carta/actualizar', verificarToken, async (req, res) => {
    await Plato.findByIdAndUpdate(req.body.id, { precio: req.body.nuevoPrecio });
    res.json({ error: false, mensaje: "Precio actualizado.", carta: await Plato.find() });
});

app.post('/api/carta/ocultar', verificarToken, async (req, res) => {
    const plato = await Plato.findById(req.body.id); 
    plato.oculto = !plato.oculto; 
    await plato.save();
    res.json({ error: false, mensaje: plato.oculto ? "Plato oculto." : "Plato visible.", carta: await Plato.find() });
});

app.post('/api/carta/nuevo', verificarToken, async (req, res) => {
    await new Plato(req.body).save();
    res.json({ error: false, mensaje: "Plato añadido.", carta: await Plato.find() });
});

app.delete('/api/carta/:id', verificarToken, async (req, res) => {
    await Plato.findByIdAndDelete(req.params.id);
    res.json({ error: false, mensaje: "Plato eliminado.", carta: await Plato.find() });
});

// GESTIÓN DE ALÉRGENOS (Nueva funcionalidad)
app.post('/api/carta/alergenos', verificarToken, async (req, res) => {
    try {
        const { id, alergeno } = req.body;
        const plato = await Plato.findById(id);
        if (plato.alergenos.includes(alergeno)) {
            plato.alergenos = plato.alergenos.filter(a => a !== alergeno);
        } else {
            plato.alergenos.push(alergeno);
        }
        await plato.save();
        res.json({ error: false, carta: await Plato.find() });
    } catch (error) {
        res.status(500).json({ error: true, mensaje: "Error al actualizar alérgenos" });
    }
});

app.listen(process.env.PORT || 3000, () => console.log(`🚀 Servidor La Taverna encendido en puerto ${process.env.PORT || 3000}`));