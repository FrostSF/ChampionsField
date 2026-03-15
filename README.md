# 🚀 Rocket Hax — Sideswipe Multiplayer

## Estructura de archivos

```
public/
├── index.html      ← Setup de perfil (nombre, título, banner, pfp)
├── lobby.html      ← Lobby con selección de equipos
├── game.html       ← Partida
├── game.js         ← Cliente: render, input, animaciones
├── lobby.js        ← Cliente: lobby
├── setup.js        ← Cliente: perfil y creación de sala
├── style.css       ← Estilos globales
└── assets/
    ├── field.png
    ├── default_pfp.png
    └── banners/
        ├── Default.png
        ├── Calculated.png
        └── ...

server.js           ← Servidor Node.js (FUERA de public/)
package.json
```

## Instalación y ejecución

```bash
npm install express socket.io
node server.js
# Abrir http://localhost:3000
```

## Controles

| Acción          | Tecla            |
|-----------------|------------------|
| Mover izquierda | `A`              |
| Mover derecha   | `D`              |
| Rotar arriba (aire) | `W`          |
| Rotar abajo (aire)  | `S`          |
| Saltar / 2do salto  | `Espacio`    |
| Boost           | `Shift izquierdo`|
| Dodge izq/der   | Salto + A/D en aire |
| Front flip      | Salto + W en aire   |

## Física implementada (como Sideswipe real)

- **Suelo**: A/D aceleran, el carro siempre mira horizontal, freno automático
- **Aire**: W/S rotan el carro (no el movimiento). El boost **siempre va en la dirección del morro**
- **Salto**: primer salto vertical, segundo salto = dodge direccional o doble salto neutro
- **Boost**: thrust en la dirección del ángulo actual del carro
- **Gravedad**: afecta al carro en el aire y a la pelota (con coeficiente reducido)
