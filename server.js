require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Conectado a MongoDB Atlas (La Taverna)'))
    .catch(err => {
        console.error('❌ Error conectando a MongoDB:');
        console.error('- Mensaje principal:', err.message);
        if (err.cause) console.error('- Causa raíz:', err.cause);
    });

const Plato = mongoose.model('Plato', new mongoose.Schema({ nombre: String, descripcion: String, precio: Number, imagen: String, categoria: { type: String, default: 'Otros' }, oculto: { type: Boolean, default: false } }));
const Reserva = mongoose.model('Reserva', new mongoose.Schema({ nombre: String, telefono: String, personas: Number, fecha: String, turno: String, alergias: String, origen: { type: String, default: 'web' } }));
const Bloqueo = mongoose.model('Bloqueo', new mongoose.Schema({ fecha: String, turno: String, motivo: String }));
const Pedido = mongoose.model('Pedido', new mongoose.Schema({ mesa: String, items: [{ nombre: String, cantidad: Number, precio: Number }], total: Number, estado: { type: String, default: 'Pendiente' }, hora: { type: Date, default: Date.now } }));

const MAX_MESAS = 15;

function verificarToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: true, mensaje: "No autorizado." });
    jwt.verify(token.split(" ")[1], process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: true, mensaje: "Sesión caducada." });
        req.usuario = decoded; next();
    });
}

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ rol: "gerente" }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ error: false, token });
    } else res.status(401).json({ error: true, mensaje: "Contraseña incorrecta." });
});

app.get('/api/carta', async (req, res) => res.json(await Plato.find()));
app.get('/api/bloqueos', async (req, res) => res.json(await Bloqueo.find()));

app.post('/api/reservas', async (req, res) => {
    const { nombre, telefono, personas, fecha, turno, alergias, forzar } = req.body;
    if (!forzar) {
        const bloqueado = await Bloqueo.findOne({ fecha, turno: { $in: [turno, "Todos"] } });
        if (bloqueado) return res.status(400).json({ error: true, mensaje: "Turno no disponible." });
        const reservasTurno = await Reserva.countDocuments({ fecha, turno });
        if (reservasTurno >= MAX_MESAS) return res.status(400).json({ error: true, mensaje: "Turno completo." });
    }
    const nuevaReserva = await new Reserva({ nombre, telefono, personas, fecha, turno, alergias, origen: forzar ? 'gerencia' : 'web' }).save();
    res.json({ error: false, mensaje: `Reserva confirmada: ${fecha} a las ${turno}`, reserva: nuevaReserva });
});

app.post('/api/pedidos', async (req, res) => {
    const nuevoPedido = await new Pedido(req.body).save();
    res.json({ error: false, mensaje: "¡Comanda enviada a cocina!" });
});

app.post('/api/carta/actualizar', verificarToken, async (req, res) => {
    await Plato.findByIdAndUpdate(req.body.id, { precio: req.body.nuevoPrecio });
    res.json({ error: false, mensaje: "Precio actualizado.", carta: await Plato.find() });
});
app.post('/api/carta/ocultar', verificarToken, async (req, res) => {
    const plato = await Plato.findById(req.body.id); plato.oculto = !plato.oculto; await plato.save();
    res.json({ error: false, mensaje: plato.oculto ? "Plato ocultado." : "Plato visible.", carta: await Plato.find() });
});
app.post('/api/carta/nuevo', verificarToken, async (req, res) => {
    await new Plato(req.body).save();
    res.json({ error: false, mensaje: "Plato añadido.", carta: await Plato.find() });
});
app.delete('/api/carta/:id', verificarToken, async (req, res) => {
    await Plato.findByIdAndDelete(req.params.id);
    res.json({ error: false, mensaje: "Plato eliminado.", carta: await Plato.find() });
});
app.post('/api/reservas/bloquear', verificarToken, async (req, res) => {
    const { fechaInicio, fechaFin, turnos, motivo } = req.body;
    let actual = new Date(fechaInicio + "T12:00:00Z"); const fin = new Date(fechaFin + "T12:00:00Z"); const nuevosBloqueos = [];
    while(actual <= fin) { const fechaStr = actual.toISOString().split('T')[0]; turnos.forEach(t => nuevosBloqueos.push({ fecha: fechaStr, turno: t, motivo })); actual.setDate(actual.getDate() + 1); }
    await Bloqueo.insertMany(nuevosBloqueos);
    res.json({ error: false, mensaje: `Bloqueo aplicado.` });
});

// Endpoint para que el gerente pueda borrar un bloqueo individual
app.delete('/api/bloqueos/:id', verificarToken, async (req, res) => {
    try {
        await Bloqueo.findByIdAndDelete(req.params.id);
        res.json({ error: false, mensaje: "Turno desbloqueado." });
    } catch (error) {
        res.status(500).json({ error: true, mensaje: "Error al borrar el turno en el servidor." });
    }
});

// ¡NUEVO! Endpoint para que el gerente pueda borrar TODOS los bloqueos de un día entero a la vez
app.delete('/api/bloqueos/dia/:fecha', verificarToken, async (req, res) => {
    try {
        await Bloqueo.deleteMany({ fecha: req.params.fecha });
        res.json({ error: false, mensaje: "Día completamente liberado." });
    } catch (error) {
        res.status(500).json({ error: true, mensaje: "Error al liberar el día en el servidor." });
    }
});

app.get('/api/reservas/lista', verificarToken, async (req, res) => res.json(await Reserva.find().sort({ fecha: 1, turno: 1 })));
app.delete('/api/reservas/:id', verificarToken, async (req, res) => { await Reserva.findByIdAndDelete(req.params.id); res.json({ error: false, mensaje: "Reserva cancelada." }); });

app.get('/api/pedidos/activos', verificarToken, async (req, res) => {
    res.json(await Pedido.find({ estado: 'Pendiente' }).sort({ hora: 1 }));
});
app.put('/api/pedidos/:id', verificarToken, async (req, res) => {
    await Pedido.findByIdAndUpdate(req.params.id, { estado: req.body.estado });
    res.json({ error: false, mensaje: "Pedido marcado como servido." });
});

app.listen(process.env.PORT || 3000, () => console.log(`🚀 Servidor en puerto ${process.env.PORT || 3000}`));