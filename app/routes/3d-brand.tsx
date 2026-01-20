import { createRoute } from 'honox/factory'
import BrandCanvas from '../islands/brand-canvas/index'

export default createRoute((c) => {
    return c.render(
        <>
            <head>
                <title>Noggin Neighbors - 3D Brand</title>
                <link href="https://fonts.googleapis.com/css2?family=Fredoka+One&display=swap" rel="stylesheet" />
                <style dangerouslySetInnerHTML={{
                    __html: `
                    body { margin: 0; overflow: hidden; font-family: 'Fredoka One', cursive; }
                    .brand-overlay {
                        position: absolute;
                        top: 5%;
                        left: 50%;
                        transform: translate(-50%, 0);
                        text-align: center;
                        z-index: 10;
                        pointer-events: none;
                        width: 100%;
                    }
                    .brand-title {
                        font-family: 'Fredoka One', cursive;
                        font-size: 80px;
                        color: #FDD835; /* Yellow */
                        text-shadow: 
                            4px 4px 0px #FBC02D, /* Darker Yellow Shadow */
                            8px 8px 0px #4CAF50, /* Green Shadow */
                            10px 10px 10px rgba(0,0,0,0.2);
                        line-height: 1.1;
                        -webkit-text-stroke: 2px #000;
                    }
                    .brand-subtitle {
                        font-family: 'Fredoka One', cursive;
                        font-size: 60px;
                        color: #66BB6A; /* Green */
                        text-shadow: 
                            4px 4px 0px #388E3C,
                            6px 6px 6px rgba(0,0,0,0.2);
                        -webkit-text-stroke: 2px #FFF;
                        margin-top: -10px;
                    }
                `}} />
            </head>
            <body>
                <div className="brand-overlay">
                    <img src="/static/noggin_neighbors logo.png" alt="Noggin Neighbors" style={{ width: '80%', maxWidth: '600px', height: 'auto' }} />
                </div>
                <BrandCanvas />
            </body>
        </>
    )
})
